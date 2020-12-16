// eslint-disable-next-line @typescript-eslint/no-var-requires
require("dotenv").config();
import cron from "node-cron";
import express from "express";
import * as cons from "consolidate";
import express_compression from "compression";
import { extname, join } from "path";
import { existsSync, readFile } from "fs";

import config from "./config.json";
import { humanizebytes, is_none } from "./utils/swissknife";
import { AdminRoute, ShortenerAPI, UploadAPI } from "./routes";
import { RedisDB } from "./utils/redisdb";
import { DELETED_ERROR } from "./utils/error_message";
import { clearExpiredFile } from "./utils/file_retention";

// @ts-ignore
const REDIS_INSTANCE = new RedisDB(config.redisdb.host, config.redisdb.port, config.redisdb.password);

const app = express();
app.engine("html", cons.atpl);
app.set("view engine", "html");
app.set("views", __dirname + "/views");

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
    res.header(
        "Access-Control-Allow-Headers",
        "Content-type,Accept,x-access-token,X-Key"
    );
    if (req.method == "OPTIONS") {
        res.status(200).end();
    } else {
        next();
    }
});

app.use(express_compression());
app.use("/static", express.static(join(__dirname, "assets")));

app.get("/", (_, res) => {
    res.render("home", {
        hostname: config.hostname,
        https_mode: config.https_mode,
        FSIZE_LIMIT: humanizebytes(config.storage.filesize_limit * 1024),
        BLACKLIST_EXTENSION: config.blocklist.extension,
        BLACKLIST_CTYPES: config.blocklist.content_type,
        ENABLE_FILE_RETENTION: config.file_retention.enable,
        FILE_RETENTION_MIN_AGE: config.file_retention.min_age,
        FILE_RETENTION_MAX_AGE: config.file_retention.max_age
    })
})

// echoback
app.head("/echo", (_, res) => {
    res.header({
        "Content-Length": 2,
        "Content-Type": "text/plain; charset=utf-8"
    })
    res.end();
})

app.get("/echo", (_, res) => {
    res.send("OK");
})

app.use("/upload", UploadAPI);
app.use("/short", ShortenerAPI);
app.use("/admin", AdminRoute);

app.get("/:idpath", (req, res) => {
    let filepath = req.path;
    if (filepath.startsWith("/")) {
        filepath = filepath.slice(1);
    }
    let extension = extname(filepath);
    let filename_only = filepath.replace(extension, "");
    if (filename_only.startsWith("ihacdn")) {
        filename_only = filename_only.slice(6);
    }
    filename_only = "ihacdn" + filename_only;
    console.log(`[CDNMapping] Trying to access: ${filename_only}`);
    REDIS_INSTANCE.get(filename_only).then((get_data) => {
        if (is_none(get_data)) {
            console.error(`[CDNMapping] Key ${filename_only} doesn't exist`);
            let missing_key = DELETED_ERROR;
            missing_key = missing_key.replace(/\{\{ FN \}\}/g, filename_only);
            res.status(404).end(missing_key);
        } else {
            if (get_data["type"] === "short") {
                console.info(`[CDNMapping] Key ${filename_only} is a short link, redirecting...`);
                res.redirect(get_data["target"]);
            } else if (get_data["type"] === "code") {
                console.info(`[CDNMapping] Key ${filename_only} are code type, rendering page...`);
                readFile(get_data["path"], (err, buf) => {
                    if (err) {
                        REDIS_INSTANCE.delete(filename_only).then(() => {
                            let gone_forever = DELETED_ERROR;
                            gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                            res.status(410).end(gone_forever);
                        }).catch(() => {
                            let gone_forever = DELETED_ERROR;
                            gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                            res.status(410).end(gone_forever);
                        })
                    } else {
                        let code_contents = buf.toString();
                        if (!is_none(code_contents) || code_contents) {
                            let code_snippets = code_contents.slice(0, 10);
                            res.render("codepaste", {
                                FILENAME: filename_only,
                                CODE_SNIPPETS: code_snippets,
                                CODE_DATA: code_contents,
                                CODE_TYPE: extension === "" ? get_data["mimetype"] : extension.slice(1),
                            });
                        } else {
                            REDIS_INSTANCE.delete(filename_only).then(() => {
                                let gone_forever = DELETED_ERROR;
                                gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                                res.status(410).end(gone_forever);
                            }).catch(() => {
                                let gone_forever = DELETED_ERROR;
                                gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                                res.status(410).end(gone_forever);
                            })
                        }
                    }
                })
            } else if (get_data["type"] === "file") {
                console.info(`[CDNMapping] Key ${filename_only} are file type, sending file...`);
                try {
                    if (!existsSync(get_data["path"])) {
                        REDIS_INSTANCE.delete(filename_only).then(() => {
                            let gone_forever = DELETED_ERROR;
                            gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                            res.status(410).end(gone_forever);
                        }).catch(() => {
                            let gone_forever = DELETED_ERROR;
                            gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                            res.status(410).end(gone_forever);
                        })
                    } else {
                        res.sendFile(get_data["path"]);
                    }
                } catch (e) {
                    console.log(get_data["path"]);
                    console.error(e);
                    REDIS_INSTANCE.delete(filename_only).then(() => {
                        let gone_forever = DELETED_ERROR;
                        gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                        res.status(410).end(gone_forever);
                    }).catch(() => {
                        let gone_forever = DELETED_ERROR;
                        gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                        res.status(410).end(gone_forever);
                    })
                }
            } else {
                let missing_key = DELETED_ERROR;
                missing_key = missing_key.replace(/\{\{ FN \}\}/g, filename_only);
                res.status(404).end(missing_key);
            }
        }
    }).catch(() => {
        let missing_key = DELETED_ERROR;
        missing_key = missing_key.replace(/\{\{ FN \}\}/g, filename_only);
        res.status(404).end(missing_key);
    })
})

const listener = app.listen(6969, () => {
    console.log("🚀 ihaCDN is now up and running!");
    // @ts-ignore
    console.log("http://127.0.0.1:" + listener.address().port);
})

// Run retention clearance every hour
cron.schedule("*/60 * * * *", () => {
    clearExpiredFile().then(() => {
        // void
    }).catch((err) => {
        console.error("[Retention] Error occured:");
        console.error(err);
    })
});
