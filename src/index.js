// Ministers' genders are configured in wrangler.toml [vars.MINISTER_GENDERS].
const MINISTRIES = {
  pm: { field: null, institution: "Lietuvos Respublikos Vyriausybė\nGedimino pr. 11, LT-01103 Vilnius", email: "lrvkanceliarija@lrv.lt" },
  aplinkos: { field: "aplinkos", email: "info@am.lt" },
  ekonomikos: { field: "ekonomikos ir inovacijų", email: "kanc@eimin.lt" },
  energetikos: { field: "energetikos", email: "info@enmin.lt" },
  finansu: { field: "finansų", email: "finmin@finmin.lt" },
  krasto_apsaugos: { field: "krašto apsaugos", email: "kam@kam.lt" },
  kulturos: { field: "kultūros", email: "info@lrkm.lt" },
  socialines_apsaugos: { field: "socialinės apsaugos ir darbo", email: "post@socmin.lt" },
  susisiekimo: { field: "susisiekimo", email: "sumin@sumin.lt" },
  sveikatos_apsaugos: { field: "sveikatos apsaugos", email: "ministerija@sam.lt" },
  svietimo: { field: "švietimo, mokslo ir sporto", email: "smmin@smsm.lt" },
  teisingumo: { field: "teisingumo", email: "rastine@tm.lt" },
  uzsienio_reikalu: { field: "užsienio reikalų", email: "urm@urm.lt" },
  vidaus_reikalu: { field: "vidaus reikalų", email: "bendrasisd@vrm.lt" },
  zemes_ukio: { field: "žemės ūkio", email: "zum@zum.lt" },
};

// [nominative, accusative, dative] endings of "ministras"/"ministrė" and "pirmininkas"/"pirmininkė"
const ENDINGS = { m: ["as", "ą", "ui"], f: ["ė", "ę", "ei"] };

function minister(id, gender) {
  const { field, institution, email } = MINISTRIES[id];
  const [nom, acc, dat] = ENDINGS[gender] ?? ENDINGS.m;
  const dear = gender === "f" ? "Gerbiamoji" : "Gerbiamasis";
  if (!field) {
    return {
      id,
      nominative: `Ministr${nom} Pirminink${nom}`,
      accusative: `Ministr${acc} Pirminink${acc}`,
      dative: `Ministr${dat} Pirminink${dat}`,
      greeting: `${dear} Ministre Pirmininke`,
      institution,
      email,
    };
  }
  return {
    id,
    nominative: `${field} ministr${nom}`,
    accusative: `${field} ministr${acc}`,
    dative: `${field} ministr${dat}`,
    greeting: `${dear} Ministre`,
    institution: `Lietuvos Respublikos ${field} ministerija`,
    email,
  };
}

const systemPrompt = (m) => `Tu padedi Lietuvos piliečiams parengti oficialų kreipimąsi į Lietuvos Respublikos ${m.accusative}.
Naudotojas pateiks savo klausimą ar teiginį. Parašyk taisyklinga, mandagia, dalykiška lietuvių kalba oficialų raštą pagal šią struktūrą:

[Vardas Pavardė]
[Adresas]
[El. paštas, telefonas]

Lietuvos Respublikos ${m.dative}
${m.institution}

PRAŠYMAS DĖL <trumpa tema kilmininku>

[Data], [Vieta]

${m.greeting},

<2–4 pastraipos: aplinkybės, problema, aiškiai suformuluotas klausimas ar prašymas>

Pagarbiai
[Vardas Pavardė]

Taisyklės:
- Neišgalvok faktų, skaičių, įstatymų ar straipsnių numerių, kurių naudotojas nepateikė.
- Laužtinių skliaustų vietas palik naudotojui užpildyti.
- Išvesk tik rašto tekstą, be jokių paaiškinimų.
- Jei naudotojo tekstas nėra klausimas ar teiginys, tinkamas kreipimuisi į Vyriausybę, vis tiek parašyk mandagų oficialų raštą jo tema.`;

const MAX_LEN = 2000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const genders = env.MINISTER_GENDERS ?? {};
    if (url.pathname === "/api/ministers") {
      return Response.json(Object.keys(MINISTRIES).map((id) => minister(id, genders[id])));
    }
    if (url.pathname !== "/api/generate" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const { success } = await env.LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "" });
    if (!success) {
      return Response.json({ error: "Per daug užklausų. Pabandykite po minutės." }, { status: 429 });
    }

    let question, ministerId, variant;
    try {
      ({ question, minister: ministerId = "pm", variant = "?" } = await request.json());
    } catch {}
    if (!Object.hasOwn(MINISTRIES, ministerId)) {
      return Response.json({ error: "Nežinomas adresatas." }, { status: 400 });
    }
    if (typeof question !== "string" || !question.trim() || question.length > MAX_LEN) {
      return Response.json({ error: `Įveskite klausimą (iki ${MAX_LEN} simbolių).` }, { status: 400 });
    }

    const upstream = await fetch("https://ollama.varomdarom.lt/api/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt(minister(ministerId, genders[ministerId])) },
          { role: "user", content: question.trim() },
        ],
      }),
    });
    if (!upstream.ok) {
      console.error("ollama", upstream.status, await upstream.text());
      return Response.json({ error: "Nepavyko sugeneruoti. Pabandykite vėliau." }, { status: 502 });
    }

    const data = await upstream.json();
    // A/B metric: which flag variant the user had. No question text or PII logged.
    console.log(JSON.stringify({ event: "generate", variant, minister: ministerId }));
    return Response.json({ text: data.message.content });
  },
};
