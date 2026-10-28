// Fixture "real sites" for the extension, routed by Host header. Chromium maps
// the hostnames to this server with --host-resolver-rules.
import { createServer } from "node:http";

const PORT = Number(process.env.SITES_PORT ?? 4567);

const SF = [
  ["Olive Garden", "Italian · Chain", "3.1 (912 reviews)"],
  ["Chili's", "American · Chain", "3.0 (455 reviews)"],
  ["Zuni Café", "Californian · Hayes Valley", "4.4 (3,120 reviews)"],
  ["House of Prime Rib", "Steakhouse · Nob Hill", "4.5 (8,004 reviews)"],
  ["Rintaro", "Izakaya · Mission", "4.6 (1,203 reviews)"],
  ["State Bird Provisions", "New American · Fillmore", "4.5 (2,876 reviews)"],
  ["Che Fico", "Italian · Divisadero", "4.4 (1,450 reviews)"],
  ["Kin Khao", "Thai · Union Square", "4.3 (1,990 reviews)"],
];

const page = (title, body, head = "") => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;margin:0} header{padding:8px;background:#eee} .results{display:flex;flex-direction:column;gap:8px;padding:12px;max-width:640px}
.biz{display:flex;gap:12px;padding:10px;border:1px solid #ccc;border-radius:8px} .biz img{width:64px;height:64px}
.info{display:flex;flex-direction:column} ul.plain{list-style:none;padding:12px;max-width:640px} ul.plain li{padding:10px;border-bottom:1px solid #ddd}
.grid{display:grid;grid-template-columns:repeat(4,120px);gap:10px;padding:12px} .poster{width:120px} .poster img{width:120px;height:180px;display:block}</style>${head}</head>
<body><header><form><input name="find_desc" value="dinner"><input name="find_loc" value="San Francisco"></form></header>${body}</body></html>`;

const bizCard = ([name, cat, rating], i) =>
  `<div class="biz" data-name="${name}"><img src="/img.svg" alt=""><div class="info"><a class="name" href="/biz/${i}">${name}</a><span class="cat">${cat}</span><span class="rating">${rating}</span></div></div>`;

const flexList = (rows) => `<h1>Best Dinner in San Francisco, CA</h1><div class="results" id="results">${rows.map(bizCard).join("")}</div>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#bbb"/></svg>`;

function yelp(path, url) {
  if (path === "/search") return page("Yelp search", flexList(SF));
  if (path === "/block")
    return page(
      "Yelp list",
      `<h1>Best Dinner in San Francisco, CA</h1><ul class="plain" id="results">${SF.map(
        ([n, c, r], i) => `<li class="row" data-name="${n}"><a href="/biz/${i}">${n}</a> <span>${c}</span> <span>${r}</span></li>`,
      ).join("")}</ul>`,
    );
  if (path === "/table")
    return page(
      "Yelp table",
      `<h1>Best Dinner in San Francisco, CA</h1><table id="results"><tbody>${SF.map(
        ([n, c, r], i) => `<tr class="r" data-name="${n}"><td><a href="/biz/${i}">${n}</a></td><td>${c}</td><td>${r}</td></tr>`,
      ).join("")}</tbody></table>`,
    );
  if (path === "/login")
    return page("Yelp log in", `${flexList(SF)}<form><label>Password <input type="password" name="pw"></label></form>`);
  if (path === "/infinite") {
    const first = SF.filter(([n]) => n !== "Rintaro").slice(0, 5);
    const more = [SF[4], ["Nari", "Thai · Japantown", "4.5 (600 reviews)"], ["Lazy Bear", "American · Mission", "4.6 (900 reviews)"]];
    return page(
      "Yelp infinite",
      `${flexList(first)}<button id="more">Load more</button><script>
const more=${JSON.stringify(more)};
document.getElementById('more').onclick=()=>{const r=document.getElementById('results');
more.forEach(([n,c,rt],i)=>{r.insertAdjacentHTML('beforeend','<div class="biz" data-name="'+n+'"><img src="/img.svg" alt=""><div class="info"><a class="name" href="/biz/m'+i+'">'+n+'</a><span class="cat">'+c+'</span><span class="rating">'+rt+'</span></div></div>')});};
</script>`,
    );
  }
  if (path === "/spa") {
    const page1 = SF.filter(([n]) => n !== "Rintaro").slice(0, 5);
    const page2 = [["Nari", "Thai", "4.5 (600 reviews)"], SF[2], SF[3], SF[4], ["Che Fico", "Italian", "4.4"]];
    return page(
      "Yelp SPA",
      `${flexList(page1)}<button id="next">Next page</button><script>
const p2=${JSON.stringify(page2)};
document.getElementById('next').onclick=()=>{history.pushState({},'','/spa?page=2&find_loc=San+Francisco');
const old=document.getElementById('results');const r=document.createElement('div');r.className='results';r.id='results';
p2.forEach(([n,c,rt],i)=>{r.insertAdjacentHTML('beforeend','<div class="biz" data-name="'+n+'"><img src="/img.svg" alt=""><div class="info"><a class="name" href="/biz/p'+i+'">'+n+'</a><span class="cat">'+c+'</span><span class="rating">'+rt+'</span></div></div>')});
old.replaceWith(r);};
</script>`,
    );
  }
  return null;
}

function route(host, path, url) {
  if (path === "/img.svg") return { type: "image/svg+xml", body: svg };
  if (host === "www.yelp.com") {
    const body = yelp(path, url);
    return body ? { type: "text/html", body } : null;
  }
  if (host === "example.org" && path === "/") return { type: "text/html", body: page("Example list", flexList(SF)) };
  if (host === "mail.google.com" && path === "/")
    return { type: "text/html", body: page("Inbox", flexList(SF.map(([n]) => [n, "Your reservation is confirmed", "9:15 AM"]))) };
  if (host === "letterboxd.com" && path === "/films") {
    const films = ["Paprika", "Spirited Away", "Parasite", "Moonlight", "Lady Bird", "Hereditary", "Toy Story", "The Godfather"];
    return {
      type: "text/html",
      body: page(
        "Films",
        `<h1>Popular films</h1><div class="grid" id="results">${films
          .map((f, i) => `<a class="poster" href="/film/${i}" data-name="${f}"><img src="/img.svg" alt="${f}"></a>`)
          .join("")}</div>`,
      ),
    };
  }
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  const hit = route(host, url.pathname, url);
  if (!hit) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end(`no fixture for ${host}${url.pathname}`);
  }
  res.writeHead(200, { "content-type": `${hit.type}; charset=utf-8` });
  res.end(hit.body);
}).listen(PORT, "127.0.0.1", () => console.log(`fixture sites on ${PORT}`));
