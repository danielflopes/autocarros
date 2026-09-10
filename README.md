# Autocarros — Linha Suburbana (Metro Mondego)

Página única, sem backend. Horários da Linha Suburbana do Metro Mondego
(Coimbra-B / República ↔ Corvo / Lousã / Serpins) embutidos no próprio
HTML — dias úteis, sábados, e domingos/feriados, 37 paragens, nos dois
sentidos.

Mostra o próximo autocarro de uma estação escolhida, com contagem
decrescente. A estação fica guardada em `localStorage` do browser.

Sem dependências externas a não ser a Google Fonts (cosmético — sem
internet, cai para as fontes do sistema e funciona na mesma).

Tem favicon e ícone para "Adicionar ao ecrã principal" no iOS
(`apple-touch-icon.png`, `favicon.ico`/`.png`, `manifest.webmanifest`).
São ficheiros à parte — o iOS não lê `apple-touch-icon` como `data:` URI
(a primeira tentativa embutida no `index.html` falhou por isso), tem de
ser um URL real.

## Atualizar os horários

Os dados estão dentro do `index.html`, no objeto `FULL_DATA`. Quando o
Metro Mondego publicar horários novos, é preciso regenerar esse objeto e
publicar um `index.html` novo — não há como atualizar só os horários sem
reenviar o ficheiro inteiro.

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
