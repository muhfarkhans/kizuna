require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const fs = require("fs");

const express = require("express");
const app = express();
app.use(express.json());

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

  if (text.startsWith("!meal")) {
    try {
      if (!fs.existsSync("meal.json")) {
        return await message.reply("⚠️ File meal.json tidak ditemukan.");
      }

      const raw = fs.readFileSync("meal.json");
      const data = JSON.parse(raw);

      const parts = text.split(" ");
      let dayIndex;

      if (parts.length === 1) {
        const today = new Date().getDay();
        dayIndex = today === 0 ? 6 : today - 1;
      } else {
        dayIndex = parseInt(parts[1]);
        if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
          return await message.reply(
            "⚠️ Masukkan angka hari antara 0 (Senin) sampai 6 (Minggu)."
          );
        }
      }

      const hariNama = [
        "Senin",
        "Selasa",
        "Rabu",
        "Kamis",
        "Jumat",
        "Sabtu",
        "Minggu",
      ];
      const menu = data[dayIndex] || ["Menu belum tersedia"];

      const messageText = `🍽 *Menu Hari ${hariNama[dayIndex]}:*\n${menu
        .map((m, i) => `${i + 1}. ${m}`)
        .join("\n")}`;

      await message.reply(messageText);
    } catch (error) {
      console.error("Meal Command Error:", error.message);
      await message.reply("⚠️ Terjadi kesalahan saat mengambil menu.");
    }
  }

  if (text.startsWith("!setmeal ")) {
    const match = text.match(/^!setmeal\s+(\d+)\s+"(.+?)"$/);

    if (!match) {
      return message.reply(
        '⚠️ Format salah. Contoh: !setmeal 0 "nasi putih, nasi goreng"'
      );
    }

    const index = parseInt(match[1]);
    const menuItems = match[2].split(",").map((item) => item.trim());

    if (index < 0 || index > 5) {
      return message.reply("⚠️ Index harus antara 0 (Senin) sampai 5 (Sabtu).");
    }

    try {
      let data = [];

      if (fs.existsSync("meal.json")) {
        const raw = fs.readFileSync("meal.json");
        data = JSON.parse(raw);
      }

      while (data.length < 6) {
        data.push(["Menu belum tersedia"]);
      }

      data[index] = menuItems;

      fs.writeFileSync("meal.json", JSON.stringify(data, null, 2));
      return message.reply(`✅ Menu untuk hari ke-${index} berhasil disimpan.`);
    } catch (err) {
      console.error("Meal JSON Error:", err.message);
      return message.reply("⚠️ Gagal menyimpan menu.");
    }
  }

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

app.post("/send-meal", async (req, res) => {
  const { number } = req.body;

  if (!number) {
    return res
      .status(400)
      .json({ status: false, message: "Nomor atau grup WA wajib diisi." });
  }

  try {
    const formattedNumber = number.includes("@") ? number : number + "@c.us";

    if (!formattedNumber.endsWith("@g.us")) {
      const isRegistered = await client.isRegisteredUser(formattedNumber);
      if (!isRegistered) {
        return res.status(422).json({
          status: false,
          message: "Nomor tidak terdaftar di WhatsApp.",
        });
      }
    }

    if (!fs.existsSync("meal.json")) {
      return res
        .status(404)
        .json({ status: false, message: "File meal.json tidak ditemukan." });
    }

    const raw = fs.readFileSync("meal.json");
    const data = JSON.parse(raw);

    const todayIndex = new Date().getDay() - 1;
    const menu = data[todayIndex] || ["Menu belum tersedia"];

    const messageText = `🍽 *Menu Hari Ini:*\n${menu
      .map((m, i) => `${i + 1}. ${m}`)
      .join("\n")}`;

    await client.sendMessage(formattedNumber, messageText);

    return res.status(200).json({
      status: true,
      message: "Pesan menu berhasil dikirim.",
      hari: todayIndex,
      dikirimKe: formattedNumber,
    });
  } catch (error) {
    console.error("Send Message Error:", error.message);
    return res
      .status(500)
      .json({ status: false, message: "Gagal mengirim pesan." });
  }
});

app.listen(3000, () => {
  console.log("🚀 Endpoint aktif di http://localhost:3000");
});
