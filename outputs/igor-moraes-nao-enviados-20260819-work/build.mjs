import fs from "node:fs/promises";
import { Workbook } from "@oai/artifact-tool";

const rows = [
  {
    "lead_id": 10535,
    "nome": "washingtonfonseca234",
    "telefone": "5565981505334",
    "email": "provisorio+5565981505334@gmail.com",
    "empreendimento": "",
    "empreendimento_id_katsuki": "",
    "etapa_atual": "Follow Up 4",
    "tags": "Atendimento IA | Cliente Respondeu | Desqualificado | FUP1 | FUP2 | FUP4",
    "origem": "WA",
    "criado_em": "2026-08-15 13:06:02",
    "atualizado_em": "2026-08-18 10:00:11",
    "historico_url": "https://hub.katsuki.com.br/historico/286d4b7c-d111-4e5a-9718-d8ed1361051c"
  },
  {
    "lead_id": 10544,
    "nome": "Celiana Matos",
    "telefone": "5565992517074",
    "email": "provisorio+5565992517074@gmail.com",
    "empreendimento": "",
    "empreendimento_id_katsuki": "",
    "etapa_atual": "Perdido",
    "tags": "Atendimento IA | Cliente Respondeu",
    "origem": "WA",
    "criado_em": "2026-08-15 14:51:54",
    "atualizado_em": "2026-08-15 14:53:26",
    "historico_url": "https://hub.katsuki.com.br/historico/b6df0630-6347-4aef-b68b-b35cf0f14c5a"
  },
  {
    "lead_id": 10588,
    "nome": "Erivelto Borges Junior",
    "telefone": "5565999837999",
    "email": "provisorio+5565999837999@gmail.com",
    "empreendimento": "",
    "empreendimento_id_katsuki": "",
    "etapa_atual": "Follow Up 2",
    "tags": "Atendimento IA | Cliente Respondeu | FUP1 | FUP2",
    "origem": "WA",
    "criado_em": "2026-08-16 12:57:16",
    "atualizado_em": "2026-08-17 10:10:06",
    "historico_url": "https://hub.katsuki.com.br/historico/bc509d46-927a-4a37-9e48-f8e9d8fceb59"
  },
  {
    "lead_id": 10593,
    "nome": "João",
    "telefone": "5566992722792",
    "email": "provisorio+5566992722792@gmail.com",
    "empreendimento": "Amani Comfort Home",
    "empreendimento_id_katsuki": "f42c1f3c-393f-4ee0-a84b-1afb07ec00b9",
    "etapa_atual": "Follow Up 2",
    "tags": "Atendimento IA | Cliente Respondeu | Desqualificado | FUP1 | FUP2",
    "origem": "WA",
    "criado_em": "2026-08-16 13:35:45",
    "atualizado_em": "2026-08-17 20:48:55",
    "historico_url": "https://hub.katsuki.com.br/historico/66c1b5a9-f4f3-4db5-ba42-c8ec1d0594ba"
  },
  {
    "lead_id": 10599,
    "nome": "Denis",
    "telefone": "5566999755255",
    "email": "provisorio+5566999755255@gmail.com",
    "empreendimento": "",
    "empreendimento_id_katsuki": "",
    "etapa_atual": "Perdido",
    "tags": "Atendimento IA | Cliente Respondeu",
    "origem": "WA",
    "criado_em": "2026-08-16 14:56:29",
    "atualizado_em": "2026-08-16 15:04:52",
    "historico_url": "https://hub.katsuki.com.br/historico/7888cadc-e58a-4364-9467-28874b3f2807"
  },
  {
    "lead_id": 10619,
    "nome": "Vanessa Caetano 😘",
    "telefone": "5565999402851",
    "email": "provisorio+5565999402851@gmail.com",
    "empreendimento": "",
    "empreendimento_id_katsuki": "",
    "etapa_atual": "Perdido",
    "tags": "Atendimento IA | Cliente Respondeu",
    "origem": "WA",
    "criado_em": "2026-08-16 19:09:21",
    "atualizado_em": "2026-08-16 19:11:52",
    "historico_url": "https://hub.katsuki.com.br/historico/951c644a-0d14-4778-8eef-a8568109af69"
  },
  {
    "lead_id": 10625,
    "nome": "Moniqui 😇 Psicopedagoga😇",
    "telefone": "5565996672737",
    "email": "provisorio+5565996672737@gmail.com",
    "empreendimento": "",
    "empreendimento_id_katsuki": "",
    "etapa_atual": "Follow Up 2",
    "tags": "Atendimento IA | Cliente Respondeu | FUP1 | FUP2",
    "origem": "WA",
    "criado_em": "2026-08-16 21:36:40",
    "atualizado_em": "2026-08-17 10:22:05",
    "historico_url": "https://hub.katsuki.com.br/historico/8ae3b06a-0376-400f-934d-e831094e7fc4"
  },
  {
    "lead_id": 10635,
    "nome": "Welington Cardoso",
    "telefone": "5565981198511",
    "email": "provisorio+5565981198511@gmail.com",
    "empreendimento": "",
    "empreendimento_id_katsuki": "",
    "etapa_atual": "Follow Up 2",
    "tags": "Atendimento IA | Cliente Respondeu | Desqualificado | FUP1 | FUP2",
    "origem": "WA",
    "criado_em": "2026-08-17 07:45:53",
    "atualizado_em": "2026-08-18 10:18:05",
    "historico_url": "https://hub.katsuki.com.br/historico/8d2b6bd1-ad17-4080-bae9-9fbd1ed350c1"
  },
  {
    "lead_id": 10642,
    "nome": "Laura Elizangela",
    "telefone": "5565996091412",
    "email": "provisorio+5565996091412@gmail.com",
    "empreendimento": "",
    "empreendimento_id_katsuki": "",
    "etapa_atual": "Follow Up 1",
    "tags": "Atendimento IA | Cliente Respondeu | FUP1",
    "origem": "WA",
    "criado_em": "2026-08-17 09:59:31",
    "atualizado_em": "2026-08-17 10:24:09",
    "historico_url": "https://hub.katsuki.com.br/historico/7a8918c5-d6a0-45eb-aa13-871a845c1a20"
  },
  {
    "lead_id": 10676,
    "nome": "Cazin",
    "telefone": "5561991119492",
    "email": "provisorio+5561991119492@gmail.com",
    "empreendimento": "Amani Comfort Home",
    "empreendimento_id_katsuki": "f42c1f3c-393f-4ee0-a84b-1afb07ec00b9",
    "etapa_atual": "Follow Up 2",
    "tags": "Atendimento IA | FUP1 | FUP2",
    "origem": "WA",
    "criado_em": "2026-08-17 20:06:30",
    "atualizado_em": "2026-08-18 10:22:08",
    "historico_url": "https://hub.katsuki.com.br/historico/56cd8395-a169-4f9c-afbb-a49cd262505a"
  },
  {
    "lead_id": 10677,
    "nome": "Jair Junio",
    "telefone": "5565996096256",
    "email": "provisorio+5565996096256@gmail.com",
    "empreendimento": "Amani Comfort Home",
    "empreendimento_id_katsuki": "f42c1f3c-393f-4ee0-a84b-1afb07ec00b9",
    "etapa_atual": "Follow Up 2",
    "tags": "Atendimento IA | Cliente Respondeu | FUP1 | FUP2",
    "origem": "WA",
    "criado_em": "2026-08-17 20:44:05",
    "atualizado_em": "2026-08-18 10:22:08",
    "historico_url": "https://hub.katsuki.com.br/historico/9b72c2e8-66b1-450f-8cfa-eb226666d860"
  }
];
const headers = [
  [
    "lead_id",
    "ID do lead"
  ],
  [
    "nome",
    "Nome"
  ],
  [
    "telefone",
    "Telefone"
  ],
  [
    "email",
    "E-mail"
  ],
  [
    "empreendimento",
    "Empreendimento"
  ],
  [
    "empreendimento_id_katsuki",
    "ID do empreendimento no Katsuki"
  ],
  [
    "etapa_atual",
    "Etapa atual"
  ],
  [
    "tags",
    "Tags"
  ],
  [
    "origem",
    "Origem"
  ],
  [
    "criado_em",
    "Criado em"
  ],
  [
    "atualizado_em",
    "Atualizado em"
  ],
  [
    "historico_url",
    "Histórico"
  ]
];
const outputPath = "D:/Projects/katsuki-crm/repo/outputs/igor-moraes-leads-nao-enviados.csv";
const previewPath = "D:/Projects/katsuki-crm/repo/outputs/igor-moraes-nao-enviados-20260819-work/preview.png";

function csvCell(value) {
  const text = String(value ?? "");
  return '"' + text.replaceAll('"', '""') + '"';
}

const csvLines = [
  headers.map(([, label]) => csvCell(label)).join(","),
  ...rows.map((row) => headers.map(([key]) => csvCell(row[key])).join(",")),
];
const csvText = "\uFEFF" + csvLines.join("\r\n") + "\r\n";

const workbook = await Workbook.fromCSV(csvText.replace(/^\uFEFF/, ""), {
  sheetName: "Leads não enviados",
});
const lastRow = rows.length + 1;
const inspection = await workbook.inspect({
  kind: "table",
  range: `Leads não enviados!A1:L${lastRow}`,
  include: "values,formulas",
  tableMaxRows: Math.min(lastRow, 20),
  tableMaxCols: 12,
});
console.log(inspection.ndjson);

const preview = await workbook.render({
  sheetName: "Leads não enviados",
  range: `A1:L${lastRow}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
await fs.writeFile(outputPath, csvText, "utf8");
console.log(JSON.stringify({ outputPath, rowCount: rows.length, previewPath }));
