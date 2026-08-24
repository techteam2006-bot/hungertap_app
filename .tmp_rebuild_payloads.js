const fs = require("fs");
const crypto = require("crypto");

const jobs = [
  {
    name: "retry-refund",
    file: "d:/TROVX WEBS/hungertap_app/supabase/functions/retry-refund/index.ts",
    verify_jwt: false,
  },
  {
    name: "create-order-v2",
    file: "d:/TROVX WEBS/hungertap_app/supabase/migrations_pending/_extracted_create-order-v2.ts",
    verify_jwt: true,
  },
  {
    name: "razorpay-webhook-v2",
    file: "d:/TROVX WEBS/hungertap_app/supabase/migrations_pending/_extracted_razorpay-webhook-v2.ts",
    verify_jwt: false,
  },
  {
    name: "verify-razorpay-payment",
    file: "d:/TROVX WEBS/hungertap_app/supabase/migrations_pending/_extracted_verify-razorpay-payment.ts",
    verify_jwt: true,
  },
];

for (const j of jobs) {
  const content = fs.readFileSync(j.file, "utf8").replace(/\r\n/g, "\n");
  const payload = {
    project_id: "mgyfyutxtapgggcwkknw",
    name: j.name,
    entrypoint_path: "index.ts",
    verify_jwt: j.verify_jwt,
    files: [{ name: "index.ts", content }],
  };
  const outJson = `d:/TROVX WEBS/hungertap_app/.tmp_mcp_deploy_${j.name}.json`;
  fs.writeFileSync(outJson, JSON.stringify(payload));
  const sha = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  console.log(j.name, content.length, sha, content.includes("razorpay"));
}
