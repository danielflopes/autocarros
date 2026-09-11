# Autocarros (Metro Mondego)

Página única, sem backend. Uma só vista: escolhes a paragem e vês tudo
o que lá passa, dos dois serviços do Metro Mondego.

- **Suburbana** (Coimbra-B / República ↔ Corvo / Lousã / Serpins):
  horários fixos embutidos no HTML — dias úteis, sábados, e
  domingos/feriados, 37 paragens, nos dois sentidos. Dá o próximo
  autocarro com contagem decrescente. A paragem fica em `localStorage`.
- **Urbana** (Coimbra B / República / Vale das Flores): o operador não
  publica passagens, publica frequências. As horas da urbana na tabela
  são por isso **geradas** e aparecem com `~` — parte-se da 1ª viagem na
  origem, avança-se pela frequência da banda em que cada partida cai até
  à última viagem, e soma-se o tempo medido até à paragem. Nas bandas
  com intervalo (ex.: 5–7,5 min) usa-se o ponto médio. Nas paragens que
  a urbana não serve não aparece nenhuma linha `~`.

  Uma paragem do tronco comum é servida por duas ligações com o mesmo
  destino (Colégios, para Vale das Flores, recebe as de Coimbra B e as
  da República). Gera-se **uma série só por destino**, não uma por
  ligação: o site oficial publica exatamente a mesma frequência em
  paragens de ramo (Coimbra B, República) e de tronco (Portagem,
  Colégios, Solum), o que só faz sentido se o número descrever o que
  passa naquela paragem venha de onde vier. Contar as duas séries em
  separado duplicava o mesmo autocarro.

  Pela mesma razão, uma passagem estimada que caia a 2 minutos ou menos
  de um horário real do suburbano é descartada: entre uma estimativa e um
  horário publicado à mesma hora, vale o publicado.

  As estimativas não são inventadas: a âncora (1ª e última viagem na
  origem) vem do horário oficial, e o tempo até cada paragem foi medido
  nas viagens reais do `FULL_DATA` — a urbana corre no mesmo corredor do
  suburbano e as paragens sobrepõem-se.

  Coimbra B e República são dois ramos. Para Vale das Flores descem os
  dois até à Portagem, mas **entre si ligam-se em cima**, cortando do
  Arnado para a Loja de Cidadão sem passar pela Portagem. O Aeminium só
  serve a ligação Portagem–Coimbra B. Essa perna Arnado–Loja de Cidadão
  é a única sem medição possível (nenhum serviço do `FULL_DATA` a
  percorre): 403 m estimados a 257 m/min, a velocidade medida neste
  mesmo corredor.

  Mais a norte, o troço Sereia / Celas / Polo Ciências da Saúde /
  Pediátrico / Hospitais ainda está em construção — a República é a
  última paragem funcional nesse sentido.

Ao abrir, a app escolhe sozinha o separador do dia certo (dias úteis /
sábado / domingo, conforme a data de hoje) e, na Suburbana, a tabela já
vem com scroll feito até ao próximo autocarro.

Sem dependências externas a não ser a Google Fonts (cosmético — sem
internet, cai para as fontes do sistema e funciona na mesma).

Tem favicon e ícone para "Adicionar ao ecrã principal" no iOS
(`apple-touch-icon.png`, `favicon.ico`/`.png`, `manifest.webmanifest`).
São ficheiros à parte — o iOS não lê `apple-touch-icon` como `data:` URI
(a primeira tentativa embutida no `index.html` falhou por isso), tem de
ser um URL real.

## Atualizar os horários

Os dados da Suburbana estão dentro do `index.html`, no objeto
`FULL_DATA`; os da Urbana em `URBAN_ROUTES`/`URBAN_BANDS`. Quando o
Metro Mondego publicar horários novos, é preciso regenerar esses objetos
e publicar um `index.html` novo — não há como atualizar só os horários
sem reenviar o ficheiro inteiro.

Horários válidos desde 10 de setembro de 2026.

## Relação com o Home Assistant

Esta app **já não tem cópia no Pi**. Existiu uma versão em
`config/www/autocarros.html` no repo `homeassistant`, mas foi removida em
2026-09-10 (commit `b3bb882`) quando a app se mudou de vez para o GitHub
Pages — regra da casa nº 7 desse repo: webapps pessoais, não específicas da
domótica, não ficam em `config/www/` do Pi, vão para o GitHub Pages.

O botão "Autocarros" no dashboard `apps-df` do Home Assistant aponta
diretamente para <https://danielflopes.github.io/autocarros/> (este repo).
Não há nada para sincronizar: esta pasta é a única fonte. Se um dia
aparecer de novo um `autocarros.html` em `config/www/` no repo
`homeassistant`, é resíduo antigo — pode apagar-se.
