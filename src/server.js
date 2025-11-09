// src/server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Serve static website files from /web
app.use(express.static(path.join(__dirname, "../web")));

// Optional: a simple API endpoint for testing
app.get("/api/status", (req, res) => {
  res.json({ status: "ok", message: "CricPredict server is running" });
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running at http://localhost:${PORT}`);
});
