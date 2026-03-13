import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as tc from '@actions/tool-cache'
import * as io from '@actions/io'
import * as path from 'path'
import * as fs from 'fs'
import * as child_process from 'child_process'

const SUPPORTED_PHP_VERSIONS = ['8.3', '8.4', '8.5']
const SUPPORTED_EXTENSION_BUNDLES = ['common', 'bulk', 'minimal']
const ARCH = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const MANIFEST_BASE_URL = "https://dl.static-php.dev";
const MANIFEST_URL_TEMPLATE = `${MANIFEST_BASE_URL}/static-php-cli/%s/?format=json`;

class Action {
    constructor(phpVersion, extensions, tools) {
        this.phpVersion = phpVersion
        this.extensions = extensions
        this.tools = tools
    }

    async run() {
        if (! SUPPORTED_PHP_VERSIONS.includes(this.phpVersion)) {
            core.setFailed(`Unsupported PHP version: ${this.phpVersion}. Supported versions are: ${SUPPORTED_PHP_VERSIONS.join(', ')}`)
            return
        }

        if (! SUPPORTED_EXTENSION_BUNDLES.includes(this.extensions)) {
            core.setFailed(`Unsupported extensions bundle: ${this.extensions}. Supported bundles are: ${SUPPORTED_EXTENSION_BUNDLES.join(', ')}`)
            return
        }

        core.info(`Setting up PHP ${this.phpVersion} (${this.extensions})...`)

        const manifest = await this.getManifest()

        if (! manifest) {
            core.setFailed(`Failed to retrieve manifest for PHP ${this.phpVersion} with extensions bundle ${this.extensions}.`);
            return
        }

        core.info(`Found ${manifest.length} matching PHP versions in manifest.`)

        const entry = manifest[0]
        const version = entry.name.match(/(\d+\.\d+\.\d+)/)?.[1]

        if (!version) {
            core.setFailed(`Could not extract version from manifest entry: ${entry.name}`)
            return
        }

        const toolName = `php-static-${this.extensions}-${ARCH}`
        const cacheKey = `${toolName}-${version}`
        const cachePath = path.join(process.env.RUNNER_TOOL_CACHE, toolName)

        await this.restoreCache(cachePath, cacheKey)

        const cachedPath = tc.find(toolName, version)

        if (cachedPath) {
            core.info(`Using cached PHP binary (${entry.name}).`)
            core.addPath(cachedPath)
        } else {
            core.info(`Downloading ${entry.name} from ${MANIFEST_BASE_URL}${entry.full_path}...`)

            const installPath = await this.download(entry)
            const cachedDir = await tc.cacheDir(installPath, toolName, version)
            core.addPath(cachedDir)

            await this.saveCache(cachePath, cacheKey)

            core.info(`PHP ${entry.name} binary installed and cached.`)
        }

        this.configurePhpIni()
        this.verify()
        await this.installTools()
    }

    async getManifest() {
        core.info(`Retrieving manifest for PHP ${this.phpVersion} (${this.extensions})...`)

        const today = new Date().toISOString().split('T')[0]
        const manifestCacheKey = `php-static-manifest-${this.extensions}-${today}`
        const manifestDir = path.join(process.env.RUNNER_TEMP, 'php-static-manifest')
        const manifestFile = path.join(manifestDir, `${this.extensions}.json`)

        await io.mkdirP(manifestDir)

        let manifest = await this.restoreCachedManifest(manifestDir, manifestCacheKey, manifestFile)

        if (!manifest) {
            core.info(`Fetching manifest from API...`)

            const url = MANIFEST_URL_TEMPLATE.replace('%s', this.extensions)
            manifest = await fetch(url).then(res => res.json())

            fs.writeFileSync(manifestFile, JSON.stringify(manifest))
            await this.saveCache(manifestDir, manifestCacheKey)
        }

        return manifest
            .filter(entry => entry.name.startsWith(`php-${this.phpVersion}`) && entry.name.includes(`-cli-linux-${ARCH}`))
            .sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified))
    }

    async restoreCachedManifest(manifestDir, cacheKey, manifestFile) {
        await this.restoreCache(manifestDir, cacheKey)

        if (fs.existsSync(manifestFile)) {
            core.info(`Using cached manifest (${cacheKey}).`)
            return JSON.parse(fs.readFileSync(manifestFile, 'utf-8'))
        }

        return null
    }

    async download(entry) {
        const downloadUrl = `${MANIFEST_BASE_URL}${entry.full_path}`
        const resolvedUrl = await this.resolveRedirects(downloadUrl)

        const archivePath = await tc.downloadTool(resolvedUrl)
        const extractedPath = await tc.extractTar(archivePath)
        const extractedFile = path.join(extractedPath, 'php')

        const installPath = path.join(process.env.RUNNER_TOOL_CACHE, 'php-bin')
        await io.mkdirP(installPath)

        const destination = path.join(installPath, 'php')
        await io.mv(extractedFile, destination, { force: true })
        fs.chmodSync(destination, 0o755)

        return installPath
    }

    async restoreCache(cachePath, cacheKey) {
        try {
            const restored = await cache.restoreCache([cachePath], cacheKey)

            if (restored) {
                core.info(`Restored cache from key: ${cacheKey}`)
            } else {
                core.info(`No cache found for key: ${cacheKey}`)
            }
        } catch (error) {
            core.warning(`Cache restore failed: ${error.message}`)
        }
    }

    async saveCache(cachePath, cacheKey) {
        try {
            await cache.saveCache([cachePath], cacheKey)
            core.info(`Saved cache with key: ${cacheKey}`)
        } catch (error) {
            core.warning(`Cache save failed: ${error.message}`)
        }
    }

    async installTools() {
        if (!this.tools.length) {
            return
        }

        const supported = ['composer']
        const unsupported = this.tools.filter(t => !supported.includes(t))

        if (unsupported.length) {
            core.setFailed(`Unsupported tools: ${unsupported.join(', ')}. Supported tools are: ${supported.join(', ')}`)
            return
        }

        for (const tool of this.tools) {
            if (tool === 'composer') {
                await this.installComposer()
            }
        }
    }

    async installComposer() {
        core.info(`Installing Composer...`)

        const composerVersion = await this.getLatestComposerVersion()

        if (!composerVersion) {
            core.setFailed(`Failed to determine latest Composer version.`)
            return
        }

        const toolName = 'composer'
        const cacheKey = `composer-${composerVersion}`
        const cachePath = path.join(process.env.RUNNER_TOOL_CACHE, toolName)

        await this.restoreCache(cachePath, cacheKey)

        const cachedPath = tc.find(toolName, composerVersion)

        if (cachedPath) {
            core.info(`Using cached Composer ${composerVersion}.`)
            core.addPath(cachedPath)
            return
        }

        core.info(`Downloading Composer ${composerVersion}...`)

        const downloadUrl = `https://getcomposer.org/download/${composerVersion}/composer.phar`
        const pharPath = await tc.downloadTool(downloadUrl)

        const installPath = path.join(process.env.RUNNER_TOOL_CACHE, 'composer-bin')
        await io.mkdirP(installPath)

        const destination = path.join(installPath, 'composer')
        await io.mv(pharPath, destination, { force: true })
        fs.chmodSync(destination, 0o755)

        const cachedDir = await tc.cacheDir(installPath, toolName, composerVersion)
        core.addPath(cachedDir)

        await this.saveCache(cachePath, cacheKey)

        core.info(`Composer ${composerVersion} installed and cached.`)
    }

    async getLatestComposerVersion() {
        try {
            const response = await fetch('https://getcomposer.org/versions')
            const data = await response.json()
            return data.stable[0].version
        } catch (error) {
            core.warning(`Failed to fetch Composer versions: ${error.message}`)
            return null
        }
    }

    configurePhpIni() {
        const iniDir = path.join(process.env.RUNNER_TEMP, 'php-ini')
        fs.mkdirSync(iniDir, { recursive: true })

        const iniFile = path.join(iniDir, 'php.ini')
        fs.writeFileSync(iniFile, [
            'date.timezone=UTC',
            'memory_limit=-1',
        ].join('\n') + '\n')

        core.exportVariable('PHP_INI_SCAN_DIR', iniDir)
        core.info(`PHP ini configured at ${iniFile}`)
    }

    async resolveRedirects(url) {
        const response = await fetch(url, { method: 'HEAD' })

        if (!response.ok) {
            throw new Error(`Failed to resolve URL ${url}: ${response.status} ${response.statusText}`)
        }

        return response.url
    }

    verify() {
        core.info(`Verifying installation...`)

        try {
            const whichOutput = child_process.execSync('which php').toString().trim()
            core.info(`'which php' output: ${whichOutput}`)
        } catch (error) {
            core.setFailed(`Failed to run 'which php': ${error.message}`)
        }
    }
}

const toolsInput = core.getInput('tools').trim()
const tools = toolsInput ? toolsInput.split(',').map(t => t.trim()).filter(Boolean) : []

const action = new Action(
    core.getInput('php-version'),
    core.getInput('extensions').trim(),
    tools,
)

await action.run()
