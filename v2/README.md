# Autocarros 2 (planeador de rotas)

Versão 2 da app, **à parte da v1** (que continua na raiz do repo, intocada).
Quando estiver testada, substitui-se a raiz por esta pasta.

Escolhes origem e destino (moradas, sítios ou paragens), a hora, e a app dá
itinerários com horários e transbordos, incluindo trocas entre a **Metro
Mondego** e a **SMTUC**. Sem backend: tudo corre no browser.

## Como funciona

| Peça | O quê |
|---|---|
| `scripts/build_data.py` | Descarrega as duas fontes e gera `data/network.json` (~1 MB, ~120 KB comprimido) |
| `router.js` | Motor de rotas RAPTOR (também corre em Node) |
| `app.js` + `index.html` | Interface, pesquisa de sítios, mapa |
| `test/smoke.js` | Teste rápido do motor: `node v2/test/smoke.js` |

Para ver localmente: `python3 -m http.server 8765 --directory v2`
(o `fetch` do JSON não funciona com `file://`).

### Fontes de dados

- **SMTUC** — GTFS estático oficial em
  [dados.gov.pt](https://dados.gov.pt/en/datasets/gtfs-estaticos-servicos-municipalizados-de-transportes-urbanos-de-coimbra/)
  (licença "não especificada"). Tem prazo de validade (`feed_end_date`):
  o atual vai até **12/11/2026**. A app mostra o aviso quando se pesquisa
  fora do período.
- **Metro Mondego** — ficheiros JSON do planeador
  (`planearviagem.metromondego.pt/data/`), os mesmos da v1. Não são uma API
  documentada, podem mudar. Existe um GTFS oficial da AGIT no dados.gov.pt
  ([Metro Mondego](https://dados.gov.pt/en/datasets/metro-mondego/), CC-BY)
  mas é de dezembro de 2025 e só tem a S1, por isso não serve. Se for
  atualizado, basta trocar a fonte em `build_data.py`.
- **Sítios e moradas** — [Photon](https://photon.komoot.io) (OpenStreetMap),
  limitado à zona de Coimbra. As paragens da rede também aparecem nas
  sugestões, marcadas como "Paragem". Paragens do Metro Mondego levam um
  **m** amarelo numa bolinha.
- **Mapa** — mosaicos do OpenStreetMap com Leaflet.

### Atualizar os horários

```bash
python3 v2/scripts/build_data.py
```

e publicar a pasta. Como o SMTUC muda de horário de tempos a tempos, vale a
pena voltar a correr isto quando o ficheiro no dados.gov.pt for renovado.

## Regras e simplificações

- Só horários programados, sem tempo real.
- A pé: distância em linha reta × 1,3, a 1,2 m/s. Paragens candidatas junto
  à origem/destino: até 800 m (até 2,5 km se não houver nenhuma).
  Transbordo a pé entre paragens: até 300 m.
- Margem de 60 s ao trocar de autocarro na mesma paragem.
- Até 4 transbordos.
- Rotas de recolha da SMTUC (deslocações para a garagem) são ignoradas.
- Metro Mondego tem só três tipos de dia (dias úteis, sábado,
  domingo/feriado). A app decide-o pela data: feriados nacionais e o de
  Coimbra (4 de julho), ou pelo calendário da SMTUC quando este é claro.
- Viagens depois da meia-noite (horas > 24:00) são tratadas: à 00:30 de
  sábado ainda aparecem as viagens do serviço de sexta.

## Fica para a v3

CP e SIT (outros operadores), tempo real, percursos a pé reais (OSRM /
Valhalla), tarifas.
