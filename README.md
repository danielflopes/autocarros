# Autocarros — Linha Suburbana (Metro Mondego)

Página única, sem backend. Horários da Linha Suburbana do Metro Mondego
(Coimbra-B / República ↔ Corvo / Lousã / Serpins) embutidos no próprio
HTML — dias úteis, sábados, e domingos/feriados, 37 paragens, nos dois
sentidos.

Mostra o próximo autocarro de uma estação escolhida, com contagem
decrescente. A estação fica guardada em `localStorage` do browser.

Sem dependências externas a não ser a Google Fonts (cosmético — sem
internet, cai para as fontes do sistema e funciona na mesma).

## Atualizar os horários

Os dados estão dentro do `index.html`, no objeto `FULL_DATA`. Quando o
Metro Mondego publicar horários novos, é preciso regenerar esse objeto e
publicar um `index.html` novo — não há como atualizar só os horários sem
reenviar o ficheiro inteiro.

Horários válidos desde 10 de setembro de 2026.
