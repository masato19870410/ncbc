// 岡山×Indeedのサイト無し/弱い企業を自動リサーチしてSupabaseに保存する（GitHub Actions定期実行用）
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = "https://mqkuoygyatyalkynhauj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_HONnw8Vn6XJAL94OaySFhw_RFmawq1Y";

if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY が未設定です");
  process.exit(1);
}

const AREAS_AND_CATEGORIES = [
  { area: "岡山市", category: "飲食店" },
  { area: "岡山市", category: "美容室・サロン" },
  { area: "倉敷市", category: "工務店・リフォーム" },
];

const SYSTEM_PROMPT = [
  "あなたは B2B 営業のためのリサーチャーです。ウェブ検索を使い、実在する企業・店舗の情報だけを集めます。",
  "出力言語: 日本語。推測は note に明記し、事実と分けること。",
  "与えられたエリアと業種から、Indeedに求人を出している実在の事業者を最大5件まで挙げます。各社について自社サイトの有無と品質を必ず評価します。",
  '必ず次の JSON のみを出力（前後に文章やコードフェンスを付けない）:',
  '{"prospects":[{"name":"事業者名","category":"業種","area":"所在エリア","summary":"事業内容の要約(1-2文)","contact":{"email":"","phone":"","instagram":"","form_url":"","other":""},"website":{"url":null,"status":"none|social_only|outdated|ok","note":"評価の根拠"},"sources":["参照URL"]}]}',
  "status: none=自社サイト無し, social_only=SNS/ポータルのみ, outdated=古い/低品質, ok=十分。",
  "連絡先が公開情報から分からない項目は空文字。捏造しない。",
].join("\n\n");

async function callClaude(userMsg) {
  const baseBody = {
    model: "claude-sonnet-5",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, allowed_domains: ["indeed.com"] }],
    messages: [{ role: "user", content: userMsg }],
  };
  let messages = baseBody.messages.slice();
  for (let guard = 0; guard < 6; guard++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ ...baseBody, messages }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`API error ${res.status}: ${detail}`);
    }
    const data = await res.json();
    if (data.stop_reason === "refusal") throw new Error("refused");
    if (data.stop_reason === "pause_turn") {
      messages = messages.concat([{ role: "assistant", content: data.content }]);
      continue;
    }
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return text;
  }
  throw new Error("継続上限に達しました");
}

function parseJsonLoose(t) {
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a !== -1 && b !== -1) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}

async function saveToSupabase(rec) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/prospects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      prefer: "return=minimal",
    },
    body: JSON.stringify(rec),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`Supabase insert failed (${res.status}): ${detail}`);
  }
}

async function main() {
  let total = 0;
  for (const { area, category } of AREAS_AND_CATEGORIES) {
    const userMsg = `エリア: ${area}\n業種: ${category}\n絞り込み条件: Indeedに求人を出しているが自社サイトが無い/弱い事業者を優先\n取得件数の上限: 5`;
    try {
      const text = await callClaude(userMsg);
      const parsed = parseJsonLoose(text);
      if (!parsed || !Array.isArray(parsed.prospects)) { console.error(`JSON解析失敗: ${area}×${category}`); continue; }
      for (const p of parsed.prospects) {
        if (!p || !p.name) continue;
        const status = (p.website && p.website.status) || "none";
        if (status === "ok") continue; // サイトが十分な企業は対象外
        await saveToSupabase({
          name: p.name, category: p.category || category, area: p.area || area,
          summary: p.summary || "", hypothesis: p.summary || "",
          website_status: status, website_url: (p.website && p.website.url) || null,
          website_note: (p.website && p.website.note) || "",
          contact: p.contact || {}, sources: p.sources || [], source_preset: "indeed",
        });
        total++;
      }
    } catch (e) {
      console.error(`${area}×${category} でエラー: ${e.message}`);
    }
  }
  console.log(`完了: ${total}件を保存しました`);
}

main();
