#!/usr/bin/env node

import fs from 'fs-extra'
import glob from 'glob'
import chokidar from 'chokidar'
import pug from 'pug'
import less from 'less'
import childProcess from 'child_process'
import minimist from 'minimist'
import url from 'url'
import path from 'path'
import LessPluginAutoPrefix from 'less-plugin-autoprefix'
import * as rollup from 'rollup'
import pluginNodeResolve from '@rollup/plugin-node-resolve'
import pluginBabel from '@rollup/plugin-babel'
// import linkerPlugin from '@angular/compiler-cli/linker/babel'
import util from 'util'
import eslint from 'eslint'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const argv = minimist(process.argv.slice(2))
const nodeResolve = pluginNodeResolve
const babel = pluginBabel.babel
const client = path.join(__dirname, "..")
const autoprefixPlugin = new LessPluginAutoPrefix({browsers: ["last 99 versions"]})

// ts

let compileTs = () => {
    let compile = () => {
        return new Promise((resolve, reject) => {
            let cmd = argv.dev
                ? `${path.join(client, "node_modules/.bin/tsc")} -p ${path.join(client, "tsconfig.json")}`
                : `${path.join(client, "node_modules/.bin/ngc")} -p ${path.join(client, "tsconfig-aot.json")}`
            childProcess.exec(cmd, (err, stdout, stderr) => {
                if(err || stderr)
                    reject(stderr || stdout)
                resolve()
            })
        })
            .catch(err => {
                console.log("Compile failed")
                throw err
            })
    }

    let watch = () => {
        let compileInProgress = false
        let pendingCompile = false
        let waitingChanged = false
        let compileOnChange = () => {
            if(!compileInProgress) {
                compileInProgress = true
                console.log("Compiling..")
                return compile()
                    .then(() => {
                        compileInProgress = false
                        console.log("Done")
                        if(pendingCompile) {
                            pendingCompile = false
                            return compileOnChange()
                        }
                        return Promise.resolve()
                    })
                    .then(() => {}, err => {
                        compileInProgress = false
                        pendingCompile = false
                        console.log(err)
                    })
            } else {
                pendingCompile = true
                return Promise.resolve()
            }
        }

        chokidar.watch("src/**/*.ts", {
            cwd: client
        })
            .on("change", file => {
                console.log("Changed:", file)
                if(!waitingChanged) {
                    waitingChanged = true
                    setTimeout(() => {
                        waitingChanged = false
                        lint(path.join(client, file))
                            .then(compileOnChange, err => console.log(err))
                    }, 100)
                }
            })
    }

    if(argv.dev)
        watch()
    return compile()
}

// pug

let buildPugIndex = () => {
    let build = () => {
        let timestamp = new Date().getTime()
        let index = argv.dev ? "index" : "index-aot"
        return util.promisify(pug.renderFile)(path.join(client, `views/${index}.pug`), {
            pretty: argv.dev,
            timestamp: argv.dev ? "" : timestamp
        })
            .catch(err => {
                throw `Error ${file} line ${err.line}: ${err.msg}`
            })
            .then(data => fs.outputFile(path.join(client, "target/index.html"), data))
    }

    let watch = () => {
        chokidar.watch("views/**/*.pug", {
            cwd: client
        })
            .on("change", file => {
                build()
                    .then(() => console.log("Changed:", file), err => console.log(err))
            })
    }

    if(argv.dev)
        watch()
    return build()
}

let buildPugTemplates = () => {
    let build = (file) => {
        return fs.mkdirp(path.join(client, "target", path.join(file, "..")))
            .then(() => util.promisify(pug.renderFile)(path.join(client, file), {
                doctype: "html",
                pretty: argv.dev
            }))
            .catch(err => {
                throw `Error ${file} line ${err.line}: ${err.msg}`
            })
            .then(data => fs.outputFile(path.format({
                dir: path.join(client, "target", path.dirname(file)),
                name: path.basename(file, ".pug"),
                ext: ".html"
            }), data))
    }

    let watch = (file) => {
        chokidar.watch(path.join(client, file))
            .on("change", () => {
                build(file)
                    .then(() => console.log("Changed:", file), err => console.log(err))
            })
    }

    return util.promisify(glob)("src/**/*.pug", {
        cwd: client
    })
        .then(files => files
            .reduce((promiseChain, file) => {
                if(argv.dev)
                    watch(file)
                return promiseChain.then(() => build(file))
            }, Promise.resolve()))
}

let buildPug = () => {
    return buildPugIndex()
        .then(buildPugTemplates)
}

// less

let buildLessClient = () => {
    let build = () => {
        return fs.readFile(path.join(client, "less/client.less"), "utf8")
            .then(source => less.render(source, {
                paths: client,
                plugins: [autoprefixPlugin]
            }))
            .catch(err => {
                throw `Error ${file} line ${err.line}: ${err.message}`
            })
            .then(data => fs.outputFile(path.join(client, "target/css/client.css"), data.css))
    }

    let watch = () => {
        chokidar.watch("less/**/*.less", {
            cwd: client
        })
            .on("change", file => {
                build()
                    .then(() => console.log("Changed:", file), err => console.log(err))
            })
    }

    if(argv.dev)
        watch()
    return build()
}

let buildLessTemplateStyles = () => {
    let build = (file) => {
        return fs.mkdirp(path.join(client, "target", path.join(file, "..")))
            .then(() => fs.readFile(path.join(client, file), "utf8"))
            .then(data => less.render(data, {
                paths: [client],
                plugins: [autoprefixPlugin]
            }))
            .catch(err => {
                throw `Error ${file} line ${err.line}: ${err.message}`
            })
            .then(data => fs.outputFile(path.format({
                dir: path.join(client, "target", path.dirname(file)),
                name: path.basename(file, ".less"),
                ext: ".css"
            }), data.css))
    }

    let watch = (file) => {
        chokidar.watch(path.join(client, file))
            .on("change", () => {
                build(file)
                    .then(() => console.log("Changed:", file), err => console.log(err))
            })
    }

    return util.promisify(glob)("src/**/*.less", {
        cwd: client
    })
        .then(files => files
            .reduce((promiseChain, file) => {
                if(argv.dev)
                    watch(file)
                return promiseChain.then(() => build(file))
            }, Promise.resolve()))
}

let buildLess = () => {
    return buildLessClient()
        .then(buildLessTemplateStyles)
}

// copy

let copyFiles = () => {
    return fs.copy(path.join(client, "public"), path.join(client, "target"))
        .then(() => {
            if(argv.dev)
                return Promise.all(["systemjs.config.js", "systemjs-angular-loader.js"]
                    .map(file => fs.copy(path.join(client, file), path.join(client, "target", file))))
            else
                return fs.copy(path.join(client, "src"), path.join(client, "target/src"))
        })
        .then(() => {
            let packages = [
                "bootstrap",
                "@fortawesome",
                "zone.js",
            ]

            if(argv.dev)
                packages = packages.concat([
                    "@angular",
                    "rxjs",
                    "@ng-bootstrap",
                    "systemjs",
                    "reflect-metadata",
                    "tslib",
                ])

            return Promise.all(packages.map(pkg => fs.copy(path.join(client, "node_modules", pkg), path.join(client, "target/node_modules", pkg))))
        })
}

// lint

let lint = (file) => {
    let options = {
        fix: false,
        formatter: "json"
    }
    let linter = new eslint.Linter(options, path.join(client, "eslint.json"))

    let lintFile = (file) => {
        return new Promise((resolve, reject) => fs.readFile(file, "utf8")
            .then(source => {
                let messages = linter.verify(path.basename(file), source)
                if(messages.errorCount > 0) {
                    messages.failures.forEach(failure => {
                        let startLine = failure.startPosition.lineAndCharacter.line + 1
                        let message = failure.failure
                        console.log(`Error ${path.relative(client, file)} line ${startLine}: ${message}`)
                    })
                    reject("Lint failed")
                }
                resolve()
        }))
    }

    if(file)
        return lintFile(file)

    return util.promisify(glob)("src/**/!(*.d).ts", {
        cwd: client
    })
        .then(files => files
            .reduce((promiseChain, file) => promiseChain
                .then(() => lintFile(path.join(client, file))), Promise.resolve()))
}

// bundle

let bundle = () => {
    return rollup.rollup({
        context: "window",
        input: path.join(client, "target/src/main-aot.js"),
        onwarn: (warning) => {
            console.log(warning.message)
        },
        plugins: [
            nodeResolve(),
            babel({
                presets: ["@babel/preset-env", {
                    corejs: {
                        version: 3,
                        proposals: true
                    },
                    useBuiltIns: "usage",
                }],
                babelHelpers: "bundled",
                plugins: ["@babel/plugin-external-helpers"],
                include: path.join(client, "node_modules"),
                babelrc: false,
                compact: true,
                minified: true,
                comments: false
            })
        ],
        treeshake: true
    })
        .then(bundle => bundle.write({
            file: path.join(client, "target/js/app.js"),
            format: "iife",
            sourcemap: true,
            sourcemapFile: path.join(client, "target/js/app.js.map"),
        }))
}

// cleanup

let cleanup = () => {
    return fs.remove(path.join(client, "target/src"))
}

// build!

console.log("Building...")

fs.remove(path.join(client, "target"))
    .then(lint)
    .then(copyFiles)
    .then(buildPug)
    .then(buildLess)
    .then(compileTs)
    .then(() => {
        if(argv.dev)
            return Promise.resolve()
        return bundle()
            .then(cleanup)
    })
    .then(() => console.log("Done"), err => {
        console.log(err)
        console.log("Exiting")
        process.exit(128)
    })
