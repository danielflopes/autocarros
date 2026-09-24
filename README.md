# Autocarros (Metro Mondego)

Página única, sem backend. Uma só vista: escolhes a paragem e vês tudo
o que lá passa, dos dois serviços do Metro Mondego.

- **Suburbana** (Coimbra-B / República ↔ Corvo / Lousã / Serpins):
  horários fixos embutidos no HTML — dias úteis, sábados, e
  domingos/feriados, 37 paragens, nos dois sentidos. Dá o próximo
  autocarro com contagem decrescente. A paragem fica em `localStorage`.
- **Urbana** (Coimbra B / República / Vale das Flores): horas reais por
  paragem, dias úteis, sábados e domingos/feriados, das viagens U1, U2 e U3
  do planeador de viagens da Metro Mondego
  (<https://planearviagem.metromondego.pt/>, ficheiros `data/trips-*.json`).
  Em cada paragem aparecem todas as passagens, com o destino; a última
  paragem de cada viagem fica de fora (aí o autocarro termina). Vêm em
  `URBAN_DATA`, em texto compacto (`"05:05v 05:11c ..."`, com v = Vale das
  Flores, c = Coimbra B, r = República).

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
