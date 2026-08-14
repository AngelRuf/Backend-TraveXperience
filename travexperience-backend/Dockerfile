# =============================================================================
# Dockerfile - TraveXperience Backend
# Multi-stage: 1) instala dependencias (con toolchain para compilar el
# binario opcional @tensorflow/tfjs-node) 2) imagen final ligera sin
# herramientas de build.
# =============================================================================

# ---------- STAGE 1: deps ----------------------------------------------------
FROM node:20-bookworm-slim AS deps

# python3/make/g++ son necesarios para node-gyp: bcrypt y el binario nativo
# opcional @tensorflow/tfjs-node se compilan en la instalación. Si la
# compilación de tfjs-node falla igual continúa (es optionalDependency) y
# aiService.js cae automáticamente al backend 100% JS (@tensorflow/tfjs).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- STAGE 2: runtime --------------------------------------------------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Usuario sin privilegios
RUN groupadd -r nodeapp && useradd -r -g nodeapp nodeapp

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Directorio de subidas: se monta como volumen, pero debe existir y ser
# escribible por el usuario de la app incluso si el volumen está vacío.
RUN mkdir -p uploads/places uploads/profiles uploads/hotels \
    && chown -R nodeapp:nodeapp /app

USER nodeapp

EXPOSE 4000

CMD ["node", "index.js"]
