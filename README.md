# `ryangjchandler/setup-php-static`

GitHub action to set up statically-compiled PHP binaries with a set of common PHP extensions.

## Quick start

```yaml
jobs:
  tests:
    runs-on: ubuntu-latest

    name: Run tests

    steps:
      - name: Setup PHP
        uses: ryangjchandler/setup-php-static@v0
        with:
          php-version: 8.4
          extensions: common # common, bulk, minimal
          tools: composer
```

## Options

**`php-version`**

The PHP version you wish to install.

Available values:
* `8.3`
* `8.4`
* `8.5`

**`extensions`**

The set of extensions you wish to use. 

Available values:
* `common` – `bcmath,bz2,calendar,ctype,curl,dom,exif,fileinfo,filter,ftp,gd,gmp,iconv,xml,mbstring,mbregex,mysqlnd,openssl,pcntl,pdo,pdo_mysql,pdo_sqlite,pdo_pgsql,pgsql,phar,posix,redis,session,simplexml,soap,sockets,sqlite3,tokenizer,xmlwriter,xmlreader,zlib,zip`
* `bulk` – `apcu,bcmath,bz2,calendar,ctype,curl,dba,dom,event,exif,fileinfo,filter,ftp,gd,gmp,iconv,imagick,imap,intl,mbregex,mbstring,mysqli,mysqlnd,opcache,openssl,opentelemetry,pcntl,pdo,pdo_mysql,pgsql,phar,posix,protobuf,readline,redis,session,shmop,simplexml,soap,sockets,sodium,sqlite3,swoole,swoole-hook-mysql,swoole-hook-pgsql,swoole-hook-sqlite,sysvmsg,sysvsem,sysvshm,tokenizer,xml,xmlreader,xmlwriter,xsl,zip,zlib`
* `minimal` – `iconv,pcntl,posix,mbstring,filter,tokenizer,phar`

**`tools`**

A comma-separate list of additional tools to install.

Available values:
* `composer` – installs Composer 2.x.
