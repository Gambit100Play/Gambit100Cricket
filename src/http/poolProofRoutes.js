// src/http/poolProofRoutes.js
import express from "express";
import { query } from "../db/db.js";
export const router = express.Router();

router.get("/pool/:matchId/lock.json", async (req, res) => {
  const { matchId } = req.params;
  const { rows } = await query(
    `SELECT snapshot_json FROM pool_locks WHERE match_id=$1 AND market_type='PreMatch'`,
    [matchId]
  );
  if (!rows.length) return res.status(404).json({ error: "not_locked" });
  res.setHeader("Content-Type", "application/json");
  res.send(rows[0].snapshot_json);
});
