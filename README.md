# Bot Afiliado (Discord, Telegram, WhatsApp e Instagram)

Bot em **Node.js** que divulga ofertas com links de afiliado da Shopee, AliExpress e Mercado Livre no Discord e no Telegram, usando somente APIs oficiais (sem scraping). Inclui um **painel web** para configurar tudo sem editar arquivos.

> Antes de publicar, valide as regras, aprovação da conta e o formato de assinatura exibidos no painel da sua aplicação. As APIs de afiliados podem habilitar métodos, campos e endpoints diferentes por país/conta.

## Instalação com Docker (recomendado)

A imagem pronta é publicada automaticamente pelo GitHub em `ghcr.io/mateus0790/botafiliado:latest` (amd64 e arm64). Ela só tem o código: nenhuma configuração, token ou login vem junto.

Baixe o [`docker-compose.yml`](docker-compose.yml) para uma pasta e rode:

```bash
docker compose up -d
docker compose logs botafiliado   # mostra o código de primeiro acesso
```

**ZimaOS / CasaOS:** na tela inicial, clique em **+** → **Instalar um app personalizado** → **Importar** e cole o conteúdo do `docker-compose.yml` (o app aparece no painel com o nome BotAfiliado).

**Montar a partir do código** (em vez de baixar a imagem): `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

1. Abra `http://IP-DO-SERVIDOR:3000`.
2. No primeiro acesso, informe o **código** que aparece no log (`[painel] Primeiro acesso: use o código XXXXXXXX…`) e crie a senha do painel. Alternativa: defina `PAINEL_SENHA` no `docker-compose.yml`.
3. Preencha as credenciais em **Discord**, **Telegram** e **Lojas e APIs**, use os botões de teste e clique em **Registrar comandos** na página do Discord.
4. Em **Postagem automática**, defina as palavras-chave, filtros e horário, e ligue.

**Levando a configuração deste PC para o Docker:** no PC, rode `node exportar-config.js`; ele gera `config-exportada.env` com tudo o que está no `.env` e no painel. Copie para a pasta do bot no servidor com o nome `.env` e suba o container com `docker compose -f docker-compose.yml -f docker-compose.env.yml up -d` (no ZimaOS/CasaOS, que não usa arquivos extras, preencha pelo painel). O arquivo contém tokens: apague-o do PC depois. A senha do painel e o histórico não vão junto.

**Mercado Livre (meli.la) no Docker:** a imagem traz Chromium, uma tela virtual (Xvfb) e noVNC. O perfil do navegador do PC não serve no container (o Windows criptografa os cookies), então faça o login lá: painel → Lojas e APIs → Mercado Livre → **Fazer login do Mercado Livre**. O painel mostra um link (porta 6080) e uma senha de 8 caracteres; abra no seu navegador, entre no Mercado Livre, confira o Gerador de links e feche a janela do navegador (ou clique em **Concluir login**). O noVNC só fica ligado enquanto o login está aberto (no máximo 20 min) e só aceita a senha mostrada. Depois, **Testar sessão meli.la**. Para usar só o modo parâmetros, remova a porta 6080 do compose. **Não rode o bot no PC e no Docker ao mesmo tempo**: com o mesmo token, os dois postam em dobro e o privado do Telegram só responde em um deles.

Tudo fica no volume `botafiliado-data` (configurações, senha do painel em hash scrypt e histórico). O `.env` é opcional (via `docker-compose.env.yml`): serve de valor inicial; o que for salvo no painel tem prioridade. Para atualizar: `docker compose pull && docker compose up -d` (os dados são mantidos).

### O painel

| Página | O que faz |
| --- | --- |
| Início | Status do Discord/Telegram, próxima e última rodada automática, ligar/desligar e "Rodar agora" |
| Postagem automática | Palavras-chave (rodízio), intervalo, ofertas por rodada, horário, ordem, nota/vendas/comissão mínimas, preço máximo, canal próprio |
| Mensagem | Texto acima da oferta e quais destinos recebem as postagens |
| WhatsApp | Kit pronto no privado do Telegram, ou conexão por QR code com escolha dos canais e grupos |
| Instagram | Token, limite diário, palavra do "comente QUERO", textos do direct e hashtags |
| Discord / Telegram | Tokens e IDs, testar conexão, registrar comandos de barra |
| Lojas e APIs | Credenciais da Shopee, AliExpress e Mercado Livre, com teste por link |
| Postar link | Pré-visualiza ou publica qualquer produto nos destinos ativos |
| Cupons | Cadastra cupons (título, código, descrição, link da página, validade, repetição); o link vira link de afiliado e o bot publica e reposta até a validade |
| Histórico | Ofertas já postadas; "liberar" permite postar o produto de novo |
| Logs | Últimas mensagens do bot, atualizando sozinho |
| Sistema | Fuso horário, tempo limite das APIs e troca de senha |

Segurança: segredos nunca são enviados de volta ao navegador (só "definido ••••1234"); sessão por cookie `HttpOnly`/`SameSite=Strict`; bloqueio após 10 senhas erradas em 15 min; CSP restritiva. O painel usa HTTP: exponha a porta só na rede local ou atrás de um proxy com HTTPS.

## Comandos no Discord

- `/afiliado link:<url>`: retorna um embed privado com o link rastreado.
- `/postar link:<url>`: evita produto repetido em SQLite e manda a oferta ao `CANAL_POSTAGEM_ID`.
- `/definir-afiliado-ml parametros:<query-string>`: administrador configura os parâmetros do Mercado Livre sem editar código; o valor fica no SQLite e substitui `ML_AFFILIATE_PARAMS`.
- `/auto status|ligar|desligar|agora|palavras|intervalo`: controla a **postagem automática** de ofertas da Shopee (somente administradores).

## Conversor no privado do Telegram

Mande `/id` para o bot no privado: ele mostra o seu ID de usuário. Coloque-o em **Telegram → Seu ID (dono)** no painel. A partir daí, cole qualquer link de produto (Shopee, AliExpress, Mercado Livre) no privado do bot e ele responde com a prévia do post e os botões **🛒 Comprar**, **✅ Postar** (publica no Discord e no canal do Telegram) e **🗑 Descartar**. Só o dono consegue usar. Encaminhar um post de um canal para o bot mostra o ID desse canal. Com "Avisar no seu privado" ligado, falhas da postagem automática e dos cupons chegam no seu privado (a mesma mensagem no máximo 1 vez por hora).

O bot lê o privado por long polling da Bot API (`getUpdates`); se outra cópia do bot estiver rodando com o mesmo token (ex.: Docker e PC ao mesmo tempo), o Telegram só entrega as mensagens para uma delas e o log avisa.

## Filtros, nichos e repetição

- **Nichos prontos** (Tecnologia, Casa, Pet…): somam palavras-chave para Shopee/AliExpress e, no Mercado Livre, usam direto a categoria certa (`services/nichos.js`).
- **Desconto mínimo, preço mínimo/máximo e palavras bloqueadas** (sem diferenciar acentos).
- **Repostar o mesmo produto depois de N dias** (0 = nunca).
- **Variações** (mesmas 5 primeiras palavras do título, ignorando cores) não são postadas de novo dentro de 7 dias.
- Preço **"De/Por"** só quando a loja informa o preço original (Mercado Livre e AliExpress); a Shopee só informa o percentual, então o "de" não é estimado.

## Cupons

Nenhuma das APIs de afiliados entrega códigos de cupom, então eles são cadastrados no painel (página **Cupons**) com o link da página do cupom, campanha ou loja. Ao salvar, o link vira link de afiliado pela via oficial de cada loja: `generateShortLink` (Shopee), `aliexpress.affiliate.link.generate` (AliExpress) ou `matt_word`/`matt_tool` (Mercado Livre); um `meli.la` colado é mantido como está. Parâmetros de rastreio de terceiros (`utm_*`, `aff_*`, `matt_*`…) são removidos antes da conversão.

A mensagem mostra o código copiável (no Telegram, toque para copiar), a validade e o botão **Pegar cupom**. Com "Repetir a postagem", o bot reposta no intervalo escolhido, só dentro do horário de postagem, e para quando o cupom vence. O texto acima dos cupons é configurável em **Mensagem**.

## Telegram

Com `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` preenchidos, toda oferta do `/postar` e da postagem automática também vai para o Telegram: foto do produto, legenda com preço/desconto/avaliação e botão **🛒 Comprar na Shopee**. Uma falha num destino não impede o outro.

1. No Telegram, fale com **@BotFather** → `/newbot` → copie o token para `TELEGRAM_BOT_TOKEN`.
2. Adicione o bot ao seu canal como **administrador** com permissão de publicar mensagens.
3. Em `TELEGRAM_CHAT_ID` use `@nomedocanal` (canal público) ou o ID numérico `-100...` (canal privado).
4. Confira sem postar nada: `node testar-telegram.js`.

## WhatsApp (Canais e grupos)

A página **WhatsApp** do painel tem dois modos, em **Como publicar**:

**Kit no privado do Telegram** (padrão, sem risco). Canais do WhatsApp não têm API oficial para publicar, então o bot manda cada oferta e cupom no seu **privado do Telegram** com a foto (segure para salvar), o texto já formatado para o WhatsApp (`*negrito*`, `~preço antigo~`, link de afiliado) num bloco que **copia com um toque** e o botão **📲 Abrir no WhatsApp**. No canal: anexe a foto, cole o texto e envie. Precisa do token do Telegram e do **Seu ID (dono)**.

**Conectar por QR code** (não oficial). O bot entra no seu WhatsApp como um **aparelho conectado** (igual ao WhatsApp Web, pela biblioteca Baileys) e posta sozinho, com foto, nos canais e grupos escolhidos:

1. Escolha "Conectar por QR code", ligue **Publicar ofertas e cupons no WhatsApp** e salve.
2. Clique em **Conectar por QR code** e escaneie no celular: WhatsApp → Aparelhos conectados → Conectar aparelho.
3. Em **Onde postar**, marque os canais (📢, só aparecem os que você é dono ou administrador) e grupos (👥) e clique em **Salvar**. A lista de canais vem do que o WhatsApp sincroniza depois do login; se um canal não aparecer, cole o link dele (`https://whatsapp.com/channel/…`) e clique em **Adicionar canal**.
4. **Mandar exemplo no meu privado** manda um exemplo para a sua própria conversa ("Você"), sem postar nos canais.

A sessão fica no volume (`data/whatsapp_auth`) e o bot reconecta sozinho ao reiniciar. Entre um destino e outro ele espera alguns segundos. **Atenção:** o WhatsApp não autoriza bots assim e pode restringir ou banir o número; use de preferência um número só para isso e não exagere na quantidade de posts. Se o aparelho for desconectado no celular, é só escanear de novo.

## Instagram ("comente QUERO")

Link na legenda do Instagram não é clicável; no direct é. Com **Instagram → Publicar ofertas** ligado, cada oferta vira um post de foto com a chamada "💬 Comente QUERO que eu te mando o link no direct!". A cada 2 minutos o bot lê os comentários dos posts dele dos últimos 7 dias e, para quem comentou a palavra, manda **o link de afiliado no direct** (resposta privada a comentário, uma por comentário) e responde em público "Te mandei o link no direct! 📩". Palavra, textos, hashtags e limite diário (padrão 10 posts/dia; acima disso a oferta vai só para os outros destinos) ficam no painel. Cupons não vão para o Instagram.

Configuração (API oficial do Instagram com login do Instagram):

1. No app do Instagram, mude para conta **Profissional** (comercial ou criador) e, em Configurações → Mensagens e respostas a stories → Ferramentas conectadas, ligue **Permitir acesso às mensagens**.
2. Em developers.facebook.com crie um app do tipo **Empresa**, adicione o produto **Instagram** → **Configuração da API com login do Instagram**.
3. Adicione a sua conta e clique em **Gerar token**, aceitando as permissões `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments` e `instagram_business_manage_messages`. Cole o token em **Instagram → Token de acesso** e use **Testar conta**.
4. **Importante:** com o app em modo de desenvolvimento a Meta só deixa mandar direct para pessoas com função no app (você e testadores). Para responder qualquer seguidor, peça **Acesso avançado** a `instagram_business_manage_comments` e `instagram_business_manage_messages` na **Análise do app** (a Meta pede vídeo mostrando o uso e, às vezes, verificação da empresa).

O token vale 60 dias e o bot o renova sozinho a cada 7. A foto precisa ser JPEG num endereço público: as fotos das lojas já são; se o Instagram recusar a foto de um produto, ele só não vai para o Instagram e o erro aparece nos logs. O bot consulta os comentários em vez de usar webhook porque o painel normalmente roda na rede local, sem HTTPS público.

## Postagem automática (Shopee)

A cada `AUTO_INTERVAL_MIN` minutos o bot pega a próxima palavra-chave do rodízio (`AUTO_KEYWORDS` ou `/auto palavras`), busca na Affiliate API (`productOfferV2` por palavra-chave, ordenado por `AUTO_SORT`), descarta produtos abaixo dos filtros (nota, vendas, comissão, preço máximo) ou já postados e publica `AUTO_POSTS_PER_RUN` oferta(s) no canal. Olha até 3 páginas de resultados por rodada e só posta dentro de `AUTO_HORARIO`.

O link usado é o `offerLink` retornado pela busca, que já é o link de afiliado da sua conta. O embed mostra preço, desconto, nota e vendas.

Para começar pelo Discord: `/auto palavras lista: fone bluetooth, smartwatch` → `/auto agora` para testar → `/auto ligar`. O `/auto` e o painel gravam a mesma configuração.

## Credenciais oficiais

### Shopee

1. Crie/cadastre a aplicação e solicite acesso ao **Shopee Affiliate Open API** no portal Shopee Open Platform/Affiliate da região.
2. Copie o **App ID** e **App Secret** aprovados para `SHOPEE_APP_ID` e `SHOPEE_APP_SECRET`.
3. Copie do painel/documentação regional a URL GraphQL autorizada para `SHOPEE_API_URL`.

Cada requisição leva o header `Authorization: SHA256 Credential=<AppId>, Timestamp=<unix>, Signature=<SHA256(AppId + Timestamp + Payload + Secret)>`. O bot extrai `shopId`/`itemId` da URL, consulta `productOfferV2(shopId, itemId)` e gera o link com a mutation `generateShortLink` (se ela falhar, usa o `offerLink` do produto). O erro `10035` significa que a sua conta ainda não tem acesso à Open API.

### AliExpress

1. Cadastre-se no **AliExpress Affiliate Portal/Open Platform** e crie uma app para receber **App Key**, **App Secret** e **Tracking ID**.
2. Habilite os métodos `aliexpress.affiliate.link.generate` e `aliexpress.affiliate.productdetail.get` no painel.
3. Preencha as três variáveis `ALIEXPRESS_*`; se necessário, forneça a URL regional oficial em `ALIEXPRESS_API_URL`.

A assinatura MD5 concatena `App Secret + parâmetros ordenados (chave+valor) + App Secret`, em hexadecimal maiúsculo; todos os parâmetros entram no hash, exceto o próprio `sign`. O `timestamp` é enviado em milissegundos. Preço vem em `ALIEXPRESS_CURRENCY` (padrão BRL).

### Mercado Livre

1. Entre no portal **Mercado Livre Afiliados** e obtenha seus parâmetros rastreáveis, como `matt_word` e `matt_tool`.
2. Defina `ML_AFFILIATE_PARAMS=matt_word=...&matt_tool=...` ou execute `/definir-afiliado-ml` como administrador.
3. A API do Mercado Livre responde **403 sem token**. Crie uma aplicação em developers.mercadolivre.com.br e preencha `ML_CLIENT_ID` e `ML_CLIENT_SECRET`: o bot gera o token do app sozinho (`client_credentials`) a cada 6 h. `ML_REFRESH_TOKEN` é opcional (token de usuário via OAuth).

**Como o bot contorna as limitações da API (testado em 10/2026):** com token de aplicativo, `/sites/MLB/search`, `/items` e o `buy_box_winner` são bloqueados ou vêm vazios. O bot usa o que é liberado:

- **Preço:** `/products/{id}/items` lista as ofertas do produto de catálogo; o bot usa a mais barata, calcula o desconto pelo `original_price` e mostra "Frete grátis" quando houver.
- **Postagem automática:** palavra-chave → `/sites/MLB/domain_discovery/search` (categoria) → `/highlights/MLB/category/{id}` (20 mais vendidos). Se a categoria não tiver lista, sobe até duas categorias na árvore — por isso palavras específicas ("caixa de som bluetooth") dão resultados mais próximos.
- A API não informa nota, vendas nem comissão: esses filtros valem só para Shopee e AliExpress; no Mercado Livre o critério é estar entre os mais vendidos (o preço máximo continua valendo).
- Anúncios avulsos (`produto.mercadolivre.com.br/MLB-123...`) seguem bloqueados (403); o bot pede o link do catálogo (`/p/MLB...`).

**Modo do link de afiliado (painel → Mercado Livre):**

- **Parâmetros** (padrão, oficial): anexa `matt_word`/`matt_tool`. Em teste real (10/2026) o clique não apareceu no relatório do portal.
- **meli.la pelo Linkbuilder** (não oficial, só fora do Docker): o firewall do Mercado Livre recusa requisições que não venham de um navegador, então o bot abre o Chrome/Edge deste PC com um perfil próprio (`data/ml_profile`) e chama o `createLink` de dentro da página do Linkbuilder, com a sua etiqueta. Faça o login uma vez com `node ml-login.js` (abre o navegador comum, sem automação). A automação não é escondida; em teste (10/2026) o modo sem janela foi recusado (HTTP 403) e com janela visível funcionou, então o padrão é "Navegador sem janela" desligado: uma janela abre por alguns segundos a cada link. É uma API interna, sujeita aos termos do programa e a mudanças sem aviso. Na automática o link só é gerado para a oferta que vai ser postada. Se a sessão expirar, o bot não posta Mercado Livre (para não publicar link sem comissão) e avisa no privado do Telegram. Botão **Testar sessão meli.la** no painel.

Links curtos (`s.shopee.com.br`, `s.click.aliexpress.com`, `mercadolivre.com/sec/...`) são expandidos antes da consulta.

O Mercado Livre não possui endpoint público para criar link de afiliado. Portanto, o bot preserva o permalink oficial do item e anexa **somente** os parâmetros fornecidos por você; ele não inventa códigos de rastreamento.

## Rodar sem Docker (Node 22.13+)

```bash
npm install
npm start          # painel em http://localhost:3000
```

Opcionalmente copie `.env.example` para `.env` para pré-preencher valores. `npm run register` registra os comandos pela linha de comando (o painel faz o mesmo pelo botão).

`DISCORD_GUILD_ID` é recomendado inicialmente: os comandos aparecem quase imediatamente no servidor de testes. Sem ele, o registro é global e pode levar até uma hora para propagar. Para obter os IDs, ative o modo de desenvolvedor no Discord; o bot precisa de escopos `bot` e `applications.commands`, permissão para enviar mensagens e incorporar links no canal de postagem.

Principais variáveis:

| Variável | Uso |
| --- | --- |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | login e registro dos comandos |
| `DISCORD_GUILD_ID` | opcional, acelera testes |
| `CANAL_POSTAGEM_ID` | canal que recebe `/postar` |
| `DATABASE_PATH` | padrão `./data/botafiliado.sqlite` (no Docker, `/app/data/...`) — só por variável |
| `PAINEL_PORTA` | porta do painel, padrão 3000 — só por variável |
| `PAINEL_SENHA` | fixa a senha do painel — só por variável |
| `REQUEST_TIMEOUT_MS` | timeout HTTP, padrão 15000 |

Todas as outras variáveis do `.env.example` também podem ser editadas no painel.

## Operação e erros

- A deduplicação é por plataforma + ID do produto e só grava após a mensagem ser enviada com sucesso.
- Erros de assinatura, credenciais inválidas, token expirado ou produto inexistente retornam uma mensagem privada com o texto da API quando disponível.
- Para rate limit (429), indisponibilidade 5xx e falhas de rede, há até três retentativas com espera exponencial. Falhas 4xx não transitórias não são repetidas.
- Nunca inclua `.env` no Git. Rotacione segredos que tenham sido expostos.

## Testes

```bash
npm test
```
