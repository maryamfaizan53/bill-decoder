/** npm run check-key — one tiny real call to confirm the key, model and network work. */
import { generateText } from "ai";
import { config, getModel } from "../lib/pipeline/config";

try {
  console.log(`Calling ${config.provider} / ${config.modelName} …`);
  const { text, usage } = await generateText({ model: getModel(), prompt: "Reply with exactly: KEY OK", maxOutputTokens: 20 });
  console.log("✅", text.trim(), `(input ${usage.inputTokens}, output ${usage.outputTokens} tokens)`);
} catch (e) {
  console.error("❌", (e as Error).message);
  process.exit(1);
}
