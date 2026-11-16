# EMDR: transporte de órdenes por WebSocket (experimental)

**Estado:** código preparado; requiere desplegar el servidor para realizar pruebas entre redes. No se han alterado las versiones de producción (`/auditivo/` y `/auditivo/movil/`).

## Por qué existe

Los diagnósticos del 16-11-2026 confirmaron señalización PeerJS correcta entre ordenador e iPhone (4G/5G), pero negociación ICE fallida. Este transporte **no usa WebRTC**: los comandos viajan del psicólogo al servidor HTTPS/WSS y de este al paciente. Cada dispositivo genera **su propio audio local**, de forma idéntica a antes.

## Componentes

- `server.js` servidor Node.js 20+ con `ws` 8.18.3, salas efímeras por código de sesión.
- `client.js` adaptador de navegador que implementa el subconjunto de PeerJS usado por ambas interfaces: `new Peer(id)`, `on('open')`, `on('connection')`, `connect(id)`, `send`, `on('data')`, `close` y `destroy`.
- `../prueba-conexion/relay/` página de prueba que utiliza el adaptador; no altera las otras rutas.

## Servidor

Se necesita un alojamiento Node.js con conexiones WebSocket persistentes y certificado TLS (WSS). **GitHub Pages por sí solo no puede alojarlo.** Antes de contratar un servicio, comprobar precios y límites; no se ha contratado nada.

```bash
cd auditivo/relay
npm install
ALLOWED_ORIGINS=https://armandmu.github.io PORT=8787 npm start
```

El proveedor de alojamiento debe exponer el puerto `PORT` como `wss://tu-dominio/`. Configura `ALLOWED_ORIGINS` con una lista separada por comas de los orígenes permitidos. Una conexión desde un origen no permitido se rechaza. La ruta HTTP `/health` permite comprobar el proceso.

En la página de prueba introduce la URL WSS en el formulario. El enlace del paciente transporta automáticamente esa URL pública y el código de sesión.

## Seguridad / alcance

- No se transfieren sonidos, voz, vídeo, historiales ni datos clínicos.
- El servidor solo admite dos roles y un cliente por rol y por sesión.
- El servidor valida y limita el tamaño de los mensajes; el paciente solo puede enviar `audio-ready`, el psicólogo solo `state` (ritmo, temporizador, reproducción).
- Las salas viven en memoria y se destruyen al desconectarse ambos dispositivos.
- Los códigos de sesión son aleatorios (8 caracteres) y funcionan como secreto compartido para acceder a la sesión. **No proporcionan autenticación clínica fuerte.** Compartirlos solo directamente con el paciente y regenerarlos para cada sesión.
- Requiere WSS cifrado. El servidor valida el origen, pero el origen por sí solo no autentica usuarios.
- No se debe utilizar el prototipo para sesiones reales hasta haber probado funcionamiento, latencia, reconexión y seguridad en diferentes navegadores y redes.

## Implantación posterior

Cuando las pruebas de relay funcionen, sustituir únicamente el transporte PeerJS por `client.js` en `/auditivo/` y `/auditivo/movil/`. Ambos mantienen las mismas estructuras de mensajes `state` y `audio-ready`. No tocar los motores de audio ni el modo presencial.

**No hay un servidor de retransmisión desplegado de momento.** Esta prueba no puede conectar dos dispositivos sin ese servidor.
