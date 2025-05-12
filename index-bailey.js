import { Boom } from "@hapi/boom";
import NodeCache from "@cacheable/node-cache";
import readline from "readline";
import {
  delay,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import pretty from "pino-pretty";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const logStream = fs.createWriteStream("./wa-logs.txt", { flags: "a" });

const logger = pino(
  {
    level: "silent",
  },
  pino.multistream([
    { stream: pretty({ colorize: true }) },
    { stream: logStream },
  ])
);

const doReplies = process.env.DO_REPLY === "true";
const usePairingCode = process.env.USE_PAIRING_CODE === "true";

const msgRetryCounterCache = new NodeCache();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const startSock = async () => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(
      "baileys_auth_info"
    );
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`using WA v${version.join(".")}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: !usePairingCode,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      msgRetryCounterCache,
      generateHighQualityLinkPreview: true,
      patchMessageBeforeSending: (message, jids) =>
        jids ? jids.map((jid) => ({ recipientJid: jid, ...message })) : message,
    });

    if (usePairingCode && !sock.authState.creds.registered) {
      const phoneNumber = await question("Please enter your phone number:\n");
      const code = await sock.requestPairingCode(phoneNumber);
      console.log(`Pairing code: ${code}`);
    }

    const sendMessageWTyping = async (msg, jid) => {
      await sock.presenceSubscribe(jid);
      await delay(500);
      await sock.sendPresenceUpdate("composing", jid);
      await delay(2000);
      await sock.sendPresenceUpdate("paused", jid);
      await sock.sendMessage(jid, msg);
    };

    sock.ev.process(async (events) => {
      if (events["connection.update"]) {
        const update = events["connection.update"];
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
          if (
            lastDisconnect?.error?.output?.statusCode !==
            DisconnectReason.loggedOut
          ) {
            startSock();
          } else {
            console.log("Connection closed. You are logged out.");
          }
        }
        console.log("connection update", update);
      }

      if (events["creds.update"]) {
        await saveCreds();
      }

      if (events["messages.upsert"]) {
        const upsert = events["messages.upsert"];

        if (upsert.type === "notify") {
          for (const msg of upsert.messages) {
            console.log("msg: ", msg);

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith("@g.us");
            const sender = isGroup
              ? msg.key.participant ||
                msg.message?.extendedTextMessage?.contextInfo?.participant
              : from;

            const text =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption;

            console.log(
              `📥 [${
                isGroup ? "GROUP" : "PRIVATE"
              }] from ${sender} in ${from}: ${text}`
            );

            if (isGroup && text?.toLowerCase().includes("halo")) {
              await sock.sendMessage(from, {
                text: `Hai 👋 @${sender.split("@")[0]}`,
                mentions: [sender],
              });
            }

            if (text?.toLowerCase() === "ping") {
              await sock.sendMessage(from, { text: "pong!" });
            }
          }
        }
      }
    });

    return sock;
  } catch (err) {
    console.error("❌ Error in startSock:", err);
  }
};

startSock();
