import express from "express";
import passport from "passport";
import bodyparser from "body-parser";
import express_session from "express-session";
import { ensureLoggedIn } from "connect-ensure-login";
import { Strategy as LocalStrategy } from "passport-local";
import { unlink as fsunlink } from "fs";
import { promisify } from "util"
import { RedisDB } from "../utils/redisdb";

import config from "../config.json";
import { generateCustomFilename, getValueFromKey, is_none } from "../utils/swissknife";
import cons from "consolidate";

// @ts-ignore
const REDIS_INSTANCE = new RedisDB(config.redisdb.host, config.redisdb.port, config.redisdb.password);
const unlink = promisify(fsunlink);

const AdminRoute = express.Router();

interface CDNItem {
    key: string
    target: string
    type: "file" | "code" | "short"
}

interface CDNData {
    files?: CDNItem[]
    pastes?: CDNItem[]
    shortlinks?: CDNItem[]
}

async function fetchAllKeysAndItems(): Promise<CDNData> {
    let ihacdn_keys = await REDIS_INSTANCE.client.keys("ihacdn*");
    if (ihacdn_keys.length < 1) {
        console.log("No saved keys");
        return {"files": [], "pastes": [], "shortlinks": []};
    }
    let ihacdn_items = await REDIS_INSTANCE.client.mget(ihacdn_keys);
    if (ihacdn_items.length < 1) {
        console.log("No saved items");
        return {"files": [], "pastes": [], "shortlinks": []};
    }

    let cdn_data: CDNData = {};
    let files_cdn: CDNItem[] = [];
    let code_cdn: CDNItem[] = [];
    let short_cdn: CDNItem[] = [];
    ihacdn_items.forEach((file, idx) => {
        let key = ihacdn_keys[idx];
        // @ts-ignore
        let parsed = JSON.parse(file);
        // @ts-ignore
        let item: CDNItem = {};
        item["key"] = key.slice(6);
        // @ts-ignore
        if (parsed["type"] === "short") {
            item["target"] = parsed["target"];
            item["type"] = "short";
            short_cdn.push(item);
        } else if (parsed["type"] === "code") {
            item["target"] = parsed["mimetype"];
            item["type"] = "code";
            code_cdn.push(item);
        } else {
            item["target"] = parsed["path"];
            item["type"] = "file";
            files_cdn.push(item);
        }
    })
    cdn_data["files"] = files_cdn;
    cdn_data["pastes"] = code_cdn;
    cdn_data["shortlinks"] = short_cdn;
    return cdn_data;
}

async function deleteCDNItem(id: string): Promise<boolean> {
    try {
        let fp = await REDIS_INSTANCE.get(`ihacdn${id}`);
        if (is_none(fp)) {
            return false;
        }
        await REDIS_INSTANCE.delete(`ihacdn${id}`);
        if (fp["type"] !== "short") {
            await unlink(fp["path"])
        }
        return true;
    } catch (e) {
        return false;
    }
    
}

passport.use(new LocalStrategy({
    usernameField: "ihacdn"
    },
    (user, password, done) => {
        if (password !== config.admin_password) {
            return done(null, false, { message: "Incorrect admin password." });
        }
        return done(null, user);
    }
));

passport.serializeUser(function(user, cb) {
    cb(null, user);
});

passport.deserializeUser(function (id, cb) {
    cb(null, id);
});

AdminRoute.use(bodyparser.urlencoded({ extended: true }));
// generate new keys everytime it started.
let super_secret_keys = generateCustomFilename(25, true, true);
console.log(`[AdminRoute] Secret Session 'secret': ${super_secret_keys}`);
AdminRoute.use(express_session({ secret: `ihacdn_${super_secret_keys}`, name: "ihacdn", resave: true, saveUninitialized: false }));
AdminRoute.use(require("flash")());

AdminRoute.use(passport.initialize());
AdminRoute.use(passport.session());

AdminRoute.get("/login", (req, res) => {
    let err_msg = null;
    // @ts-ignore
    if (req.session.flash.length > 0) {
        // @ts-ignore
        err_msg = req.session.flash[0].message;
    }
    res.render("login_page", {
        ERROR_MSG: err_msg
    });
    // @ts-ignore
    if (req.session.flash.length > 0) {
        // @ts-ignore
        req.session.flash = [];
    }
})

AdminRoute.post("/login", passport.authenticate("local", { failureRedirect: "/admin/login", failureFlash: true }), (req, res) => {
    res.redirect("/admin");
})

AdminRoute.get("/logout", (req, res) => {
    req.logout();
    res.redirect("/");
})

AdminRoute.delete("/files/:id", ensureLoggedIn("/admin/login"), (req, res) => {
    let id_del = getValueFromKey(req.params, "id");
    if (is_none(id_del)) {
        res.status(400).json({"success": 0})
    } else {
        deleteCDNItem(id_del).then((resd) => {
            if (resd) {
                res.json({"success": 1});
            } else {
                res.status(404).json({"success": 0})
            }
        }).catch((err) => {
            console.error(err);
            res.status(500).json({"success": -1})
        })
    }
})

AdminRoute.post("/files", ensureLoggedIn("/admin/login"), (req, res) => {
    fetchAllKeysAndItems().then((results) => {
        res.json(results);
    }).catch((err) => {
        console.error(err);
        res.status(500).json({ "files": [], "pastes": [], "shortlinks": [] });
    })
})

AdminRoute.get("/", ensureLoggedIn("/admin/login"), (req, res) => {
    res.render("admin_page");
})

export { AdminRoute };