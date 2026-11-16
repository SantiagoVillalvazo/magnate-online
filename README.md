# MAGNATE – Imperio corporativo (versión en línea)

Juego de mesa 3D para el navegador. Se puede jugar en una sola computadora o en línea con amigos, sin descargar nada.

## Cómo funciona
- `public/index.html` es el juego completo.
- `server.js` es un servidor pequeño que entrega el juego y maneja las **salas**: crear sala, unirse con un código de 4 letras y pasar las jugadas entre los navegadores.
- La partida la calcula el navegador del **anfitrión**; los demás reciben cada jugada y mandan sus decisiones.

## Probarlo en tu computadora (opcional)
Necesitas [Node.js](https://nodejs.org) 18 o más nuevo.

```
npm install
npm start
```

Abre `http://localhost:8080` en dos pestañas: en una crea la sala y en la otra únete con el código.

## Publicarlo en Render (gratis)
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Plan:** Free

En el plan gratuito el servidor se "duerme" tras unos 15 minutos sin uso, y la primera visita después tarda alrededor de un minuto en abrir.
