// src/tests/testLeanback.js
import { getLeanbackInfo } from "../api/cricbuzzLeanback.js";

(async () => {
  try {
    const info = await getLeanbackInfo(116936); // example match ID
    console.log(info);
  } catch (err) {
    console.error(err.message);
  }
})();
