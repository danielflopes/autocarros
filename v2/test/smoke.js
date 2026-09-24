const fs=require('fs'),path=require('path');
const R=require('../router.js');
const t0=Date.now();
const net=new R.Network(JSON.parse(fs.readFileSync(path.join(__dirname,'../data/network.json'))));
console.log('load',Date.now()-t0,'ms; places',net.places.length);
const hm=s=>{s=Math.round(s);return String(Math.floor(s/3600)%24).padStart(2,'0')+':'+String(Math.floor(s%3600/60)).padStart(2,'0')};
function q(a,b,time,date){
  const A=net.searchPlaces(a,1)[0],B=net.searchPlaces(b,1)[0];
  const t=Date.now();
  const r=net.plan({from:A,to:B,date:date||new Date(2026,8,25),time,mode:'dep'});
  console.log(`\n${A.name} → ${B.name} @${hm(time)}  (${Date.now()-t} ms, ${r.journeys.length} opções)`);
  r.journeys.forEach(j=>console.log(' ',hm(j.dep),'→',hm(j.arr),'transb',j.transfers,'a pé',Math.round(j.walk/60)+'min |',j.legs.map(l=>l.type==='walk'?'🚶'+Math.round(l.secs/60):l.route.short+'('+l.from.name+'→'+l.to.name+')').join(' ')));
}
q('Solum','Portagem',8*3600+30*60);
q('Lousã - Estação','Universidade',7*3600);
q('Vale das Flores','Hospital Sobral Cid',9*3600);
q('Coimbra B','Celas',18*3600);
q('Serpins','Olivais',12*3600);
q('Portagem','Solum',25*3600-60*30); // 00:30
q('Portagem','Solum',30*60,new Date(2026,8,26));      // 00:30 de sábado (serviço de sexta que passa da meia-noite)
q('Portagem','Solum',23*3600+30*60,new Date(2026,8,25));
q('Sé Velha','Solum',10*3600,new Date(2026,9,4));     // domingo
// chegar até
{const A=net.searchPlaces('Solum',1)[0],B=net.searchPlaces('Celas',1)[0];
 const r=net.plan({from:A,to:B,date:new Date(2026,8,25),time:9*3600,mode:'arr'});
 console.log('\nchegar até 09:00');r.journeys.forEach(j=>console.log(' ',hm(j.dep),'→',hm(j.arr),j.transfers));}
console.log('dias:',[new Date(2026,9,5),new Date(2026,11,25),new Date(2026,6,4),new Date(2026,9,10)].map(d=>d.toDateString()+' '+R.dayType(d)).join(' · '));
