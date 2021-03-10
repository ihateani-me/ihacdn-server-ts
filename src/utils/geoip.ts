import axios from "axios";
import fs from "fs";
import path from "path";
import ProgressBar from "progress";
import targz from "targz";
import { Reader, ReaderModel } from "@maxmind/geoip2-node";
import { get, has } from "lodash";

import { logger as MainLogger } from "./logger";

import config from "../config";
import { is_none } from "./swissknife";

const DB_URL = "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key={{LICENSE_KEY}}&suffix=tar.gz";
const DB_FOLDER = path.join(__dirname, "..", "geoip");
const PRIVATE_IP_RE = /\blocalhost$|(127\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|0?10\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|172\.0?1[6-9]\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|172\.0?2[0-9]\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|172\.0?3[0-2]\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|192\.168\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|169\.254\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|::1|[fF][cCdD][0-9a-fA-F]{2}(?:[:][0-9a-fA-F]{0,4}){0,7}|[fF][eE][89aAbB][0-9a-fA-F](?:[:][0-9a-fA-F]{0,4}){0,7})(?:\/([789]|1?[0-9]{2}))?\b/;
let GEOIP_DATA: ReaderModel;
if (!fs.existsSync(DB_FOLDER)) {
    fs.mkdirSync(DB_FOLDER);
}

function loadDb() {
    const logger = MainLogger.child({cls: "MaxMindGeoIP2", fn: "loadDb"});
    let mainFolder: string;
    fs.readdirSync(DB_FOLDER).forEach((e) => {
        if (fs.statSync(path.join(DB_FOLDER, e)).isDirectory() && e.startsWith("GeoLite2-Country")) {
            mainFolder = path.join(DB_FOLDER, e);
        }
    });
    logger.info("Loading database to memory...");
    // @ts-ignore
    const dbBuffer = fs.readFileSync(path.join(mainFolder, "GeoLite2-Country.mmdb"));
    GEOIP_DATA = Reader.openBuffer(dbBuffer);
    logger.info("Database loaded to memory!");
}

async function init() {
    const logger = MainLogger.child({cls: "MaxMindGeoIP2", fn: "init"});
    const analytics = config.analytics;
    if (!analytics.enable) {
        return;
    }
    if (!has(analytics, "geoip")) {
        return;
    }
    const geoip_conf = analytics.geoip;
    const license_key = get(geoip_conf, "license_key");
    if (typeof license_key !== "string") {
        return;
    }
    if (license_key.length < 1 || license_key === "" || license_key === " ") {
        return;
    }
    const savePath = path.join(DB_FOLDER, "geolite2-country.tar.gz");
    if (fs.existsSync(savePath)) {
        logger.info("DB already downloaded, loading...");
        loadDb();
        return;
    }

    logger.info("Downloading GeoLite2-Country database from MaxMind...");
    const toDL = DB_URL.replace("{{LICENSE_KEY}}", license_key);
    const {data, headers} = await axios({
        url: toDL,
        method: "GET",
        responseType: "stream"
    });
    const totalLength = headers["content-length"];
    const progress = new ProgressBar("-> Downloading [:bar] :percent :etas", {
        width: 40,
        complete: "#",
        incomplete: " ",
        renderThrottle: 1,
        total: parseInt(totalLength)
    });

    const writer = fs.createWriteStream(savePath);
    data.on("data", (chunk: any) => progress.tick(chunk.length));
    data.pipe(writer);

    data.on("end", function () {
        logger.info("Downloaded, now extracting...");
        targz.decompress({
            src: savePath,
            dest: DB_FOLDER
        }, function (err) {
            if (err) {
                logger.error("Failed to decompress...");
            } else {
                logger.info("Extracted!");
                loadDb();
            }
        })
    });
}

function getCountry(ip_addr?: string | null) {
    if (is_none(ip_addr)) {
        return "Unknown";
    }
    if (is_none(GEOIP_DATA)) {
        return "Unknown";
    }
    if (PRIVATE_IP_RE.test(ip_addr)) {
        return "Local";
    }
    try {
        return GEOIP_DATA.country(ip_addr).country?.names.en || "Unknown";
    } catch (e) {
        return "Unknown";
    }
}

export { GEOIP_DATA, init, loadDb, getCountry };
