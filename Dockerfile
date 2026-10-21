FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/botafiliado.sqlite \
    PAINEL_PORTA=3000 \
    TZ=America/Sao_Paulo \
    BOT_IN_DOCKER=1 \
    ML_BROWSER_PATH=/usr/bin/chromium \
    DISPLAY=:99
# Chromium + tela virtual (Xvfb) para o modo meli.la, e x11vnc/noVNC para o login do Mercado Livre pelo painel.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium xvfb x11vnc novnc websockify procps tini tzdata ca-certificates \
    fonts-liberation fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# Arquivos copiados do Windows (scp/SMB) podem chegar sem permissão de leitura para outros usuários.
RUN chmod -R a+rX /app && mkdir -p /app/data && chown -R node:node /app/data
USER node
# 3000 = painel; 6080 = tela do navegador durante o login do Mercado Livre (só enquanto o login estiver aberto, com senha).
EXPOSE 3000 6080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PAINEL_PORTA||3000)+'/api/session').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "/app/docker/entrypoint.sh"]
