// eslint-disable-next-line @typescript-eslint/no-var-requires
require("dotenv").config();
import cron from "node-cron";
import express from "express";
import * as cons from "consolidate";
import express_compression from "compression";
import express_cors from "cors";
import { extname, join } from "path";
import { existsSync, readFile } from "fs";

import config from "./config";
import { humanizebytes, is_none } from "./utils/swissknife";
import { AdminRoute, ShortenerAPI, UploadAPI } from "./routes";
import { RedisDB } from "./utils/redisdb";
import { DELETED_ERROR } from "./utils/error_message";
import { clearExpiredFile } from "./utils/file_retention";
import { expressErrorLogger, expressLogger, logger as MainLogger } from "./utils/logger";
import { getCountry, init as GeoIPInit } from "./utils/geoip";

// @ts-ignore
const REDIS_INSTANCE = new RedisDB(config.redisdb.host, config.redisdb.port, config.redisdb.password);

const app = express();
app.set("trust proxy", true);
app.engine("html", cons.atpl);
app.set("view engine", "html");
app.set("views", __dirname + "/views");

// @ts-ignore
app.use(express_cors());

app.use(expressLogger);
app.use(express_compression());
app.use("/static", express.static(join(__dirname, "assets")));

app.get("/", (_, res) => {
    let fslimit = "None";
    if (typeof config.storage.filesize_limit === "number") {
        fslimit = humanizebytes(config.storage.filesize_limit * 1024)
    }
    res.render("home", {
        hostname: config.hostname,
        https_mode: config.https_mode,
        FSIZE_LIMIT: fslimit,
        BLACKLIST_EXTENSION: config.blocklist.extension,
        BLACKLIST_CTYPES: config.blocklist.content_type,
        ENABLE_FILE_RETENTION: config.file_retention.enable,
        FILE_RETENTION_MIN_AGE: config.file_retention.min_age,
        FILE_RETENTION_MAX_AGE: config.file_retention.max_age,
        ENABLE_ANALYTICS: config.analytics.enable,
    })
});

app.get("/robots.txt", (_, res) => {
    res.send(
        `User-agent: *
        Disallow: /`
    );
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

async function logAnalytics(key: string, country: string) {
    await REDIS_INSTANCE.client.incr(`iharedir_stats_${key}_hits`);
    await REDIS_INSTANCE.client.lpush(`iharedir_stats_${key}_country`, country);
}

function realGetCountry(ipSets: string[]): string {
    let cc: string;
    let localDetect = false;
    for (let index = 0; index < ipSets.length; index++) {
        let test = getCountry(ipSets[index]);
        if (test === "Local") {
            localDetect = true;
        }
        // @ts-ignore
        if (!["Unknown", "Local"].includes(test) && typeof cc !== "string") {
            cc = test;
            break;
        }
    }
    // @ts-ignore
    if (typeof cc === "string") {
        return cc;
    }
    return localDetect ? "Local" : "Unknown";
}

app.get("/:idpath", async (req, res) => {
    const logger = MainLogger.child({fn: "CDNMapping"});
    let ipArrays = req.ips;
    const IPCountry = realGetCountry(ipArrays);

    let filepath = req.path;
    if (filepath.startsWith("/")) {
        filepath = filepath.slice(1);
    }
    let extension = extname(filepath);
    let filename_only = filepath.replace(extension, "");
    if (filename_only.startsWith("ihacdn")) {
        filename_only = filename_only.slice(6);
    }
    const realKey = filename_only;
    filename_only = "ihacdn" + filename_only;
    logger.info(`Trying to access: ${filename_only} (Origin country request: ${IPCountry})`);
    let redisData = await REDIS_INSTANCE.get(filename_only);
    if (is_none(redisData)) {
        logger.error(`Key ${filename_only} doesn't exist`);
        let missing_key = DELETED_ERROR;
        missing_key = missing_key.replace(/\{\{ FN \}\}/g, filename_only);
        res.status(404).end(missing_key);
    } else {
        if (redisData["type"] === "short") {
            if (config.analytics.enable) {
                await logAnalytics(realKey, IPCountry);
            }
            logger.info(`Key ${filename_only} is a short link, redirecting...`);
            res.redirect(redisData["target"]);
        } else if (redisData["type"] === "code") {
            logger.info(`Key ${filename_only} are code type, rendering page...`);
            readFile(redisData["path"], async (err, buf) => {
                if (err) {
                    await REDIS_INSTANCE.delete(filename_only);
                    let gone_forever = DELETED_ERROR;
                    gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                    res.status(410).end(gone_forever);
                } else {
                    let code_contents = buf.toString();
                    if (is_none(code_contents) || !code_contents) {
                        await REDIS_INSTANCE.delete(filename_only);
                        let gone_forever = DELETED_ERROR;
                        gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                        res.status(410).end(gone_forever);
                    } else {
                        let code_snippets = code_contents.slice(0, 10);
                        res.render("codepaste", {
                            FILENAME: filename_only,
                            CODE_SNIPPETS: code_snippets,
                            CODE_DATA: code_contents,
                            CODE_TYPE: extension === "" ? redisData["mimetype"] : extension.slice(1),
                        });
                    }
                }
            })
        } else if (redisData["type"] === "file") {
            if (!existsSync(redisData["path"])) {
                await REDIS_INSTANCE.delete(filename_only);
                let gone_forever = DELETED_ERROR;
                gone_forever = gone_forever.replace(/\{\{ FN \}\}/g, filename_only);
                res.status(410).end(gone_forever);
            } else {
                res.sendFile(redisData["path"]);
            }
        } else {
            let missing_key = DELETED_ERROR;
            missing_key = missing_key.replace(/\{\{ FN \}\}/g, filename_only);
            res.status(404).end(missing_key);
        }
    }
})

app.use(expressErrorLogger);

GeoIPInit().then(() => {
    const listener = app.listen(6969, () => {
        console.log("🚀 ihaCDN is now up and running!");
        // @ts-ignore
        console.log("http://127.0.0.1:" + listener.address().port);
    });
    
    // Run retention clearance every hour
    cron.schedule("*/60 * * * *", () => {
        const logger = MainLogger.child({fn: "FileRetention"});
        clearExpiredFile().then(() => {
            // void
        }).catch((err) => {
            logger.error("[Retention] Error occured:");
            console.error(err);
        })
    });
    
});