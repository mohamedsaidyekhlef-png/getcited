import { present } from "../src/mcp.mjs";
const out = {
  audit: await present("getcited_audit", { url: "https://www.scairos.com/getcited" }, { hosted: true }),
  xray: await present("getcited_xray", { url: "https://www.scairos.com/getcited" }, { hosted: true }),
  arena: await present("getcited_arena", { question: "What is generative engine optimization?", mine: "https://www.scairos.com/getcited", competitors: ["https://en.wikipedia.org/wiki/Generative_engine_optimization", "https://www.conductor.com/academy/generative-engine-optimization/"] }, { hosted: true }),
};
console.log("CAPTURE " + Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.data])))).toString("base64"));
