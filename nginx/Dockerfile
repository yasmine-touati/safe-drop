FROM nginx:alpine
RUN apk add --no-cache openssl
COPY nginx.conf /etc/nginx/nginx.conf
COPY gen-certs.sh /docker-entrypoint.d/10-gen-certs.sh
RUN chmod +x /docker-entrypoint.d/10-gen-certs.sh
