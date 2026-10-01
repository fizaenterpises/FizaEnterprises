const $=s=>document.querySelector(s);
const waNumber="919901884387";
function wa(text){return `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`}
async function load(){
  const [settings, packages] = await Promise.all([
    fetch("/api/public/settings").then(r=>r.json()),
    fetch("/api/public/packages").then(r=>r.json())
  ]);
  document.title=`${settings.business_name} | ${settings.tagline}`;
  $("#headerWa").href=wa("Assalamu Alaikum, I would like assistance with Hajj/Umrah.");
  $("#heroWa").href=wa("Assalamu Alaikum, I would like to know about your Hajj and Umrah assistance.");
  $("#waContact").href=wa("Assalamu Alaikum, I would like personal Hajj/Umrah assistance.");
  $("#floatWa").href=wa("Assalamu Alaikum, I need Hajj/Umrah assistance.");
  $("#footerPhone").textContent=settings.phone; $("#footerPhone").href=`tel:${settings.phone}`;
  $("#footerTagline").textContent=settings.tagline;
  $("#packageGrid").innerHTML=packages.map(p=>`
    <article class="card"><div class="card-top"></div><div class="card-body">
      <span class="badge">${p.type.toUpperCase()}</span><h3>${esc(p.name)}</h3>
      <p>${esc(p.subtitle)}</p><p>${esc(p.description)}</p>
      <ul>${esc(p.inclusions).split("\\n").filter(Boolean).map(x=>`<li>${x}</li>`).join("")}</ul>
      <a class="btn gold choose" data-id="${p.id}" href="#enquiry">Request Assistance →</a>
    </div></article>`).join("");
  $("#packageSelect").innerHTML='<option value="">Any suitable package</option>'+packages.map(p=>`<option value="${p.id}">${esc(p.type)} — ${esc(p.name)}</option>`).join("");
  document.querySelectorAll(".choose").forEach(b=>b.onclick=()=>{$("#packageSelect").value=b.dataset.id});
  const services=["🕋 Hajj Packages","🌙 Umrah Packages","▣ Visa Assistance","🏨 Accommodation","🚌 Transportation","🤝 Pilgrim Guidance","✈ Travel Assistance","◌ Personal Support"];
  $("#servicesGrid").innerHTML=services.map(x=>`<div class="service"><b>${x}</b></div>`).join("");
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
$("#enquiryForm").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=e.submitter; btn.disabled=true; $("#status").textContent="Sending your enquiry...";
  const data=Object.fromEntries(new FormData(e.target).entries());
  try{const r=await fetch("/api/enquiries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const x=await r.json();if(!r.ok)throw new Error(x.error||"Could not send enquiry");$("#status").textContent="Thank you. Your enquiry has been received. Our team will contact you shortly.";e.target.reset()}
  catch(err){$("#status").textContent=err.message}
  finally{btn.disabled=false}
});
load().catch(()=>{$("#status").textContent="Please refresh the page and try again."});
