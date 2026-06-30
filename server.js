const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Esta es la línea que necesitábamos. 
// Permite que el juego pueda cargar el archivo 'mozart40.mp3' y el 'index.html' sin dar errores.
app.use(express.static(__dirname));

// Ruta principal para cargar el juego
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// --- LÓGICA DE SOCKET.IO PARA TU JUEGO DE PINTO ---
let jugadores = {};
let palabraActual = "";
let guionesActuales = "";
let tiempoPartida = 80;
let idDibujanteActual = null;
let juegoIniciado = false;
let temporizadorInterval = null;

const listaPalabras = ["perro", "gato", "casa", "carro", "sol", "manzana", "computadora", "guitarra", "arbol", "pizza"];
const modosDeJuego = ["Normal", "Un Solo Trazo", "Puntos Dobles"];
let modoActual = "Normal";

function elegirPalabra() {
    return listaPalabras[Math.floor(Math.random() * listaPalabras.length)];
}

function iniciarTemporizador() {
    if(temporizadorInterval) clearInterval(temporizadorInterval);
    
    temporizadorInterval = setInterval(() => {
        if (tiempoPartida > 0) {
            tiempoPartida--;
            io.emit('tiempo_actualizado', tiempoPartida);
        } else {
            clearInterval(temporizadorInterval);
            io.emit('mensaje_sistema', `⏱️ ¡Se acabó el tiempo! La palabra era: ${palabraActual.toUpperCase()}`);
            io.emit('notificar_sonido', 'victoria');
            juegoIniciado = false;
        }
    }, 1000);
}

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    socket.on('entrar_sala', (data) => {
        jugadores[socket.id] = {
            id: socket.id,
            nombre: data.nombre,
            emoji: data.emoji || '🐱',
            puntos: 0
        };
        io.emit('actualizar_puntos', Object.values(jugadores));
        io.emit('nuevo_mensaje', { emoji: '📢', usuario: 'Sistema', texto: `¡${data.nombre} se ha unido a la sala!` });
    });

    socket.on('iniciar_partida', () => {
        const ids = Object.keys(jugadores);
        if (ids.length === 0) return;

        juegoIniciado = true;
        tiempoPartida = 80;
        idDibujanteActual = ids[Math.floor(Math.random() * ids.length)];
        palabraActual = elegirPalabra();
        guionesActuales = "_ ".repeat(palabraActual.length).trim();
        modoActual = modosDeJuego[Math.floor(Math.random() * modosDeJuego.length)];

        io.emit('actualizar_partida', {
            idDibujante: idDibujanteActual,
            guiones: guionesActuales,
            modo: modoActual,
            tiempo: tiempoPartida,
            palabraCompleta: palabraActual
        });

        iniciarTemporizador();
    });

    socket.on('dibujo_empezar', (pos) => { socket.broadcast.emit('dibujo_empezar_cliente', pos); });
    socket.on('dibujo_mover', (data) => { socket.broadcast.emit('dibujo_mover_cliente', data); });
    socket.on('dibujo_limpiar', () => { socket.broadcast.emit('dibujo_limpiar_cliente'); });
    socket.on('dibujo_relleno', (data) => { socket.broadcast.emit('dibujo_relleno_cliente', data); });
    socket.on('dibujo_deshacer', (url) => { socket.broadcast.emit('dibujo_deshacer_cliente', url); });

    socket.on('enviar_mensaje', (texto) => {
        if (!jugadores[socket.id]) return;
        const jugador = jugadores[socket.id];

        if (juegoIniciado && socket.id !== idDibujanteActual && texto.toLowerCase().trim() === palabraActual.toLowerCase().trim()) {
            let puntosGanados = modoActual === "Puntos Dobles" ? 200 : 100;
            jugador.puntos += puntosGanados;
            io.emit('actualizar_puntos', Object.values(jugadores));
            io.emit('mensaje_sistema', `🎉 ¡${jugador.nombre} adivinó la palabra! (+${puntosGanados} pts)`);
            socket.emit('notificar_sonido', 'adivinado');
            return;
        }

        io.emit('nuevo_mensaje', { emoji: jugador.emoji, usuario: jugador.nombre, texto: texto });
    });

    socket.on('disconnect', () => {
        if (jugadores[socket.id]) {
            io.emit('nuevo_mensaje', { emoji: '❌', usuario: 'Sistema', texto: `${jugadores[socket.id].nombre} abandonó la partida.` });
            delete jugadores[socket.id];
            io.emit('actualizar_puntos', Object.values(jugadores));
        }
    });
});

// Levantar el servidor en el puerto 3000
http.listen(3000, () => {
    console.log('🚀 Servidor corriendo en http://localhost:3000');
});