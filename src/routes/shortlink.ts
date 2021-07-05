import express from "express";
import multer from "multer";
import { generateCustomFilename, getValueFromKey, is_none } from "../utils/swissknife";
import config from "../config";
import { RedisDB } from "../utils/redisdb";
import { Notifier } from "../utils/notifier";
import { logger as MainLogger } from "../utils/logger";

// @ts-ignore
const REDIS_INSTANCE = new RedisDB(config.redisdb.host, config.redisdb.port, config.redisdb.password);
const ShortNotifier = new Notifier();
const ShortHelper = multer();
const ShortenerAPI = express.Router();

const URL_REGEX = /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/gmi;

async function generateFilenameAndUse(url: string, ipaddr: string): Promise<string> {
    if (Array.isArray(ipaddr)) {
        ipaddr = ipaddr[0];
    }
    let filename = generateCustomFilename(config.filename_length);
    while (true) {
        if (!["upload", "short", "ping"].includes(filename)) {
            let check_data = await REDIS_INSTANCE.get(`ihacdn${filename}`);
            if (is_none(check_data)) {
                break;
            }
        }
        filename = generateCustomFilename(config.filename_length);
    }
    await REDIS_INSTANCE.set(`ihacdn${filename}`, {
        "type": "short",
        "target": url
    })
    await ShortNotifier.notifyAll({
        filename: filename,
        type: "short",
        is_admin: false,
        uploader_ip: ipaddr
    })
    return filename;
}

ShortenerAPI.post("/", ShortHelper.single("url"), (req, res) => {
    let ipArrays = req.ips;
    let ipaddr = ipArrays as unknown as string;
    if (Array.isArray(ipArrays)) {
        ipaddr = ipArrays[0];
    }
    const logger = MainLogger.child({cls: "CDM", fn: "ShortenerAPI"});
    logger.info(`Request received from ${ipArrays.join(", ")}`);
    let url_to_shorten = getValueFromKey(req.body, "url", null);
    if (is_none(url_to_shorten)) {
        res.status(400).end("No URL provided");
    } else {
        if (!URL_REGEX.test(url_to_shorten)) {
            res.status(400).end("Invalid URL provided");
        } else {
            logger.info(`Generating new shortlink for ${ipArrays.join(", ")}`);
            // @ts-ignore
            generateFilenameAndUse(url_to_shorten, ipaddr).then((shortened) => {
                logger.info(`Shoretned ID got for ${ipArrays.join(", ")}, ${shortened}`);
                let final_url = "http://";
                if (config.https_mode) {
                    final_url = "https://";
                }
                final_url += `${config.hostname}/${shortened}`;
                res.status(200).end(final_url);
            }).catch((err) => {
                logger.error(`Error generic received for ${ipArrays.join(", ")}, ${err.toString()}`);
                res.status(500).end("Server failed to shorten link.");
            })
        }
    }
})

export { ShortenerAPI };