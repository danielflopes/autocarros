# Autocarros (Metro Mondego)

Página única, sem backend. Tem as duas linhas do Metro Mondego, num
seletor "Suburbana / Urbana" no topo:

- **Suburbana** (Coimbra-B / República ↔ Corvo / Lousã / Serpins):
  horários fixos embutidos no HTML — dias úteis, sábados, e
  domingos/feriados, 37 paragens, nos dois sentidos. Mostra o próximo
  autocarro de uma estação escolhida, com contagem decrescente. A
  estação fica guardada em `localStorage`.
- **Urbana** (triângulo Coimbra B / República / Vale das Flores, 6
  ligações direcionais): não tem horário fixo por paragem, é por
  frequência — mostra o intervalo em minutos por banda horária
  (madrugada / dia / noite), com a banda atual destacada, e a 1ª e
  última viagem **estimadas em cada paragem** do percurso. A linha
  escolhida fica guardada em `localStorage`.

  As estimativas não são inventadas: a âncora (1ª e última viagem na
  origem) vem do horário oficial, e o tempo até cada paragem seguinte
  foi medido nas viagens reais do `FULL_DATA` — o troço urbano usa o
  mesmo corredor do suburbano, as paragens sobrepõem-se.

  Coimbra B e República são dois ramos. Para Vale das Flores descem os
  dois até à Portagem, mas **entre si ligam-se em cima**, cortando do
  Arnado para a Loja de Cidadão sem passar pela Portagem (é a ligação em
  V do mapa oficial). O Aeminium só serve a ligação Portagem–Coimbra B.
  Essa perna Arnado–Loja de Cidadão é a única sem medição possível
  (nenhum serviço do `FULL_DATA` a percorre): 403 m estimados a
  257 m/min, a velocidade medida neste mesmo corredor.

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
