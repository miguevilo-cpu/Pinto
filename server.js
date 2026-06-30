const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// --- VARIABLES DE CONTROL DEL JUEGO ---
let jugadores = {};
let palabraActual = "";
let guionesActuales = "";
let tiempoPartida = 80;
let idDibujanteActual = null;
let listaIdsTurnos = []; 
let indiceTurnoActual = 0;
let juegoIniciado = false;
let temporizadorInterval = null;
let jugadoresQueAdivinaron = new Set(); 

// Nuevas variables para el control de rondas (3 rondas por jugador)
let rondaActual = 1;
const MAX_RONDAS = 3; 

const listaPalabras = ["perro", "gato", "casa", "carro", "sol", "manzana", "computadora", "guitarra", "arbol", "pizza", "control", "audifonos", "reloj", "abridor", "zapato", "helicoptero"];
const modosDeJuego = ["Normal", "Un Solo Trazo", "Puntos Dobles"];
let modoActual = "Normal";

function elegirPalabra() {
    return listaPalabras[Math.floor(Math.random() * listaPalabras.length)];
}

function avanzarSiguienteTurno() {
    if (temporizadorInterval) clearInterval(temporizadorInterval);
    jugadoresQueAdivinaron.clear(); 

    listaIdsTurnos = Object.keys(jugadores);

    if (listaIdsTurnos.length < 2) {
        finalizarPartidaPrematuro("Partida cancelada. Se necesitan al menos 2 jugadores.");
        return;
    }

    // Si es el primer turno de la partida
    if (idDibujanteActual === null) {
        indiceTurnoActual = 0;
        rondaActual = 1;
    } else {
        indiceTurnoActual++;
        // Si ya dibujaron todos los jugadores en esta ronda...
        if (indiceTurnoActual >= listaIdsTurnos.length) {
            indiceTurnoActual = 0; // Reiniciar ciclo de jugadores
            rondaActual++;         // Avanzar a la siguiente ronda global
        }
    }

    // Si superamos las 3 rondas estipuladas, el juego termina
    if (rondaActual > MAX_RONDAS) {
        declararGanadores();
        return;
    }

    idDibujanteActual = listaIdsTurnos[indiceTurnoActual];
    palabraActual = elegirPalabra();
    guionesActuales = "_ ".repeat(palabraActual.length).trim();
    modoActual = modosDeJuego[Math.floor(Math.random() * modosDeJuego.length)];
    tiempoPartida = 80;
    juegoIniciado = true;

    io.emit('actualizar_partida', {
        idDibujante: idDibujanteActual,
        guiones: guionesActuales,
        modo: modoActual,
        tiempo: tiempoPartida,
        palabraCompleta: palabraActual,
        rondaVisual: rondaActual
    });

    io.emit('mensaje_sistema', `📢 [Ronda ${rondaActual}/${MAX_RONDAS}] ¡Turno de dibujar para ${jugadores[idDibujanteActual].nombre}!`);
    io.emit('dibujo_limpiar_cliente'); 

    iniciarTemporizador();
}

function iniciarTemporizador() {
    temporizadorInterval = setInterval(() => {
        if (tiempoPartida > 0) {
            tiempoPartida--;
            io.emit('tiempo_actualizado', tiempoPartida);
        } else {
            clearInterval(temporizadorInterval);
            io.emit('mensaje_sistema', `⏱️ ¡Tiempo agotado! La palabra era: ${palabraActual.toUpperCase()}`);
            io.emit('notificar_sonido', 'victoria');
            
            setTimeout(() => {
                avanzarSiguienteTurno();
            }, 4000);
        }
    }, 1000);
}

function verificarSiTodosAdivinaron() {
    const totalJugadores = Object.keys(jugadores).length;
    const adivinadoresObjetivo = totalJugadores - 1;

    if (jugadoresQueAdivinaron.size >= adivinadoresObjetivo && adivinadoresObjetivo > 0) {
        clearInterval(temporizadorInterval);
        io.emit('mensaje_sistema', "🎉 ¡Todos han adivinado! Pasando al siguiente turno...");
        io.emit('notificar_sonido', 'victoria');

        setTimeout(() => {
            avanzarSiguienteTurno();
        }, 3000);
    }
}

function declararGanadores() {
    if (temporizadorInterval) clearInterval(temporizadorInterval);
    juegoIniciado = false;

    // Ordenar jugadores por puntos (de mayor a menor)
    let podio = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    
    // Enviar el estado final a todos los clientes
    io.emit('partida_terminada', podio);
}

function finalizarPartidaPrematuro(motivo) {
    if (temporizadorInterval) clearInterval(temporizadorInterval);
    juegoIniciado = false;
    idDibujanteActual = null;
    io.emit('mensaje_sistema', `🛑 ${motivo}`);
    io.emit('forzar_regreso_lobby');
}

io.on('connection', (socket) => {
    socket.on('entrar_sala', (data) => {
        jugadores[socket.id] = {
            id: socket.id,
            nombre: data.nombre,
            emoji: data.emoji || '🐱',
            puntos: 0
        };
        io.emit('actualizar_puntos', Object.values(jugadores));
    });

    socket.on('iniciar_partida', () => {
        if (Object.keys(jugadores).length < 2) {
            socket.emit('mensaje_sistema', "⚠️ Se necesitan al menos 2 jugadores.");
            return;
        }
        // Reiniciar puntajes al iniciar una partida nueva limpia
        for (let id in jugadores) { jugadores[id].puntos = 0; }
        io.emit('actualizar_puntos', Object.values(jugadores));
        
        idDibujanteActual = null;
        avanzarSiguienteTurno();
    });

    socket.on('dibujo_empezar', (pos) => { socket.broadcast.emit('dibujo_empezar_cliente', pos); });
    socket.on('dibujo_mover', (data) => { socket.broadcast.emit('dibujo_mover_cliente', data); });
    socket.on('dibujo_limpiar', () => { socket.broadcast.emit('dibujo_limpiar_cliente'); });
    socket.on('dibujo_relleno', (data) => { socket.broadcast.emit('dibujo_relleno_cliente', data); });
    socket.on('dibujo_deshacer', (url) => { socket.broadcast.emit('dibujo_deshacer_cliente', url); });

    socket.on('enviar_mensaje', (texto) => {
        if (!jugadores[socket.id]) return;
        const jugador = jugadores[socket.id];

        if (jugadoresQueAdivinaron.has(socket.id)) return;

        if (juegoIniciado && socket.id !== idDibujanteActual && texto.toLowerCase().trim() === palabraActual.toLowerCase().trim()) {
            let puntosGanados = modoActual === "Puntos Dobles" ? 200 : 100;
            jugador.puntos += puntosGanados;
            jugadoresQueAdivinaron.add(socket.id);
            
            io.emit('actualizar_puntos', Object.values(jugadores));
            io.emit('mensaje_sistema', `🎉 ¡${jugador.nombre} adivinó la palabra! (+${puntosGanados} pts)`);
            socket.emit('notificar_sonido', 'adivinado');
            
            verificarSiTodosAdivinaron();
            return;
        }
        io.emit('nuevo_mensaje', { emoji: jugador.emoji, usuario: jugador.nombre, texto: texto });
    });

    socket.on('disconnect', () => {
        if (jugadores[socket.id]) {
            const eraElDibujante = (socket.id === idDibujanteActual);
            delete jugadores[socket.id];
            io.emit('actualizar_puntos', Object.values(jugadores));

            if (juegoIniciado) {
                if (Object.keys(jugadores).length < 2) {
                    finalizarPartidaPrematuro("Jugadores insuficientes. Fin de la partida.");
                } else if (eraElDibujante) {
                    io.emit('mensaje_sistema', "🎨 El dibujante abandonó. Saltando turno...");
                    avanzarSiguienteTurno();
                } else {
                    verificarSiTodosAdivinaron();
                }
            }
        }
    });
});

http.listen(3000, () => { console.log('Servidor Pinto Online'); });