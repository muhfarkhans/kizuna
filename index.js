require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const fs = require("fs");

const logMessage = (text) => {
  fs.appendFileSync("log.txt", `[${new Date().toISOString()}] ${text}\n`);
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox"],
  },
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ Bot siap digunakan!");
});

client.on("message", async (message) => {
  const chat = await message.getChat();
  const text = message.body.toLowerCase();

  logMessage(`${chat.name} - ${message.from}: ${text}`);

  if (message.fromMe) return;

  if (text.startsWith("!ask ") || text.startsWith("/gpt ")) {
    const prompt = text.replace(/^(!ask|\/gpt)\s+/, "");
    if (!prompt) return message.reply("⚠️ Tolong masukkan pertanyaan.");

    const reply = await askOpenAI(prompt);
    await message.reply(reply);
  } else {
    if (chat.isGroup) {
      console.log(
        `📨 Pesan dari grup "${chat.name}" oleh ${message.author}: ${text}`
      );

      if (text === "ping") {
        await message.reply("Hai");
      }
    } else {
      console.log(`📨 Pesan dari ${message.from}: ${text}`);

      if (text === "ping") {
        await message.reply("Oi");
      } else {
        await message.reply("Nande");
      }
    }
  }
});

const askOpenAI = async (text) => {
  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-nano",
      input: [{ role: "user", content: text }],
      text: {
        format: {
          type: "text",
        },
      },
      reasoning: {},
      tools: [],
      temperature: 1,
      max_output_tokens: 2048,
      top_p: 1,
      store: true,
    });

    return response.output_text?.trim() || "⚠️ Jawaban kosong dari GPT.";
  } catch (err) {
    console.error("OpenAI Error:", err.message);
    return "⚠️ Terjadi kesalahan saat menghubungi GPT.";
  }
};

client.initialize();
