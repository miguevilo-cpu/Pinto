const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, '')));

// 3. 🧠 DICCIONARIO DE PALABRAS MÁS DIFÍCILES (Abstractas, complejas, técnicas)
const palabrasDificiles = [
    'aurora boreal', 'agujero negro', 'fotosintesis', 'neurotransmisor', 'ultrasonido',
    'apendicitis', 'esquizofrenia', 'entropia', 'arquitectura', 'renacimiento',
    'quijotesco', 'laberinto', 'criptografia', 'metamorfosis', 'telescopio',
    'estetoscopio', 'electrocardiograma', 'claustrofobia', 'caleidoscopio', 'quimera',
    'desoxirribonucleico', 'hipopotomonstrosesquipedaliofobia', 'infinitesimal', 'paradoja', 'gargantua'
];

const MODOS_JUEGO = ["Normal", "Un Solo Trazo", "Doble Palabra"];

// Estructura para almacenar el estado de las salas dinámicamente
let salas = {
    "Sala Alpha": { jugadores: {}, partidaActiva: false, idDibujante: null, palabraActual: "", palabraActual2: "", guiones: "", tiempo: 60, ronda: 0, intervalorTimers: null, historialDibujantes: [] },
    "Sala Beta":  { jugadores: {}, partidaActiva: false, idDibujante: null, palabraActual: "", palabraActual2: "", guiones: "", tiempo: 60, ronda: 0, intervalorTimers: null, historialDibujantes: [] },
    "Sala Omega": { jugadores: {}, partidaActiva: false, idDibujante: null, palabraActual: "", palabraActual2: "", guiones: "", tiempo: 60, ronda: 0, intervalorTimers: null, historialDibujantes: [] }
};

io.on('connection', (socket) => {
    let salaActual = null;

    // Enviar lista de salas disponibles apenas se conecta al inicio
    socket.emit('lista_salas', Object.keys(salas));

    socket.on('entrar_sala', (data) => {
        const { nombre, emoji, sala } = data;
        if (!salas[sala]) return;

        salaActual = sala;
        socket.join(salaActual);

        // Inicializar jugador en la sala seleccionada
        salas[salaActual].jugadores[socket.id] = {
            id: socket.id,
            nombre: nombre,
            emoji: emoji,
            puntos: 0,
            adivinado: false
        };

        io.to(salaActual).emit('mensaje_sistema', `👋 ${emoji} ${nombre} se ha unido a la ${salaActual}.`);
        io.to(salaActual).emit('actualizar_puntos', Object.values(salas[salaActual].jugadores));
    });

    socket.on('iniciar_partida', () => {
        if (!salaActual || !salas[salaActual]) return;
        let s = salas[salaActual];
        
        // 2. ⚙️ REINICIO LIMPIO AL 100% (Arregla pantalla final y reinicio)
        clearInterval(s.intervalorTimers);
        s.partidaActiva = true;
        s.ronda = 0;
        s.historialDibujantes = [];
        
        // Resetear puntos a 0 para una nueva partida limpia
        Object.keys(s.jugadores).forEach(id => {
            s.jugadores[id].puntos = 0;
            s.jugadores[id].adivinado = false;
        });

        io.to(salaActual).emit('actualizar_puntos', Object.values(s.jugadores));
        avanzarSiguienteTurno(salaActual);
    });

    socket.on('enviar_mensaje', (texto) => {
        if (!salaActual || !salas[salaActual]) return;
        let s = salas[salaActual];
        let jugador = s.jugadores[socket.id];
        if (!jugador) return;

        if (s.partidaActiva && socket.id !== s.idDibujante && !jugador.adivinado) {
            let acerto = false;
            let msgNormalizado = texto.trim().toLowerCase();

            // 4. LÓGICA MODO DOBLE PALABRA (Deben adivinar ambas palabras con un espacio en medio)
            if (s.modoActual === "Doble Palabra") {
                let combinacionCorrecta = `${s.palabraActual} ${s.palabraActual2}`;
                if (msgNormalizado === combinacionCorrecta) {
                    acerto = true;
                }
            } else {
                if (msgNormalizado === s.palabraActual.toLowerCase()) {
                    acerto = true;
                }
            }

            if (acerto) {
                jugador.adivinado = true;
                jugador.puntos += 100; // Puntos fijos por acierto duro
                
                // Darle un extra de 50 puntos al dibujante por transmitir bien su arte
                if (s.jugadores[s.idDibujante]) s.jugadores[s.idDibujante].puntos += 50;

                io.to(salaActual).emit('mensaje_sistema', `🎉 ¡${jugador.emoji} ${jugador.nombre} ADIVINÓ la palabra!`);
                io.to(salaActual).emit('notificar_sonido', 'adivinado');
                io.to(salaActual).emit('actualizar_puntos', Object.values(s.jugadores));

                // Si todos los que no dibujan adivinaron, saltar el timer para no esperar de más
                let todosAdivinaron = Object.values(s.jugadores).every(j => j.id === s.idDibujante || j.adivinado);
                if (todosAdivinaron) {
                    s.tiempo = 0;
                }
                return;
            }
        }

        io.to(salaActual).emit('nuevo_mensaje', { usuario: jugador.nombre, emoji: jugador.emoji, texto: texto });
    });

    // --- RELÉ DE TRAZOS INDEPENDIENTES POR SALA ---
    socket.on('dibujo_empezar', (pos) => { if (salaActual) socket.to(salaActual).emit('dibujo_empezar_cliente', pos); });
    socket.on('dibujo_mover', (data) => { if (salaActual) socket.to(salaActual).emit('dibujo_mover_cliente', data); });
    socket.on('dibujo_limpiar', () => { if (salaActual) socket.to(salaActual).emit('dibujo_limpiar_cliente'); });
    socket.on('dibujo_relleno', (data) => { if (salaActual) socket.to(salaActual).emit('dibujo_relleno_cliente', data); });
    socket.on('dibujo_deshacer', (url) => { if (salaActual) socket.to(salaActual).emit('dibujo_deshacer_cliente', url); });

    socket.on('disconnect', () => {
        if (salaActual && salas[salaActual] && salas[salaActual].jugadores[socket.id]) {
            let s = salas[salaActual];
            let j = s.jugadores[socket.id];
            io.to(salaActual).emit('mensaje_sistema', `❌ ${j.emoji} ${j.nombre} abandonó la sala.`);
            delete s.jugadores[socket.id];
            io.to(salaActual).emit('actualizar_puntos', Object.values(s.jugadores));

            if (Object.keys(s.jugadores).length === 0) {
                clearInterval(s.intervalorTimers);
                s.partidaActiva = false;
                s.ronda = 0;
            } else if (socket.id === s.idDibujante) {
                s.tiempo = 0; // Forzar cambio de turno si el dibujante se va
            }
        }
    });
});

function avanzarSiguienteTurno(sala) {
    let s = salas[sala];
    if (!s) return;

    // 1. 🏁 CONDICIÓN DE FIN DE JUEGO FIJADO A EXACTAMENTE 9 RONDAS
    if (s.ronda >= 9 || Object.keys(s.jugadores).length === 0) {
        s.partidaActiva = false;
        clearInterval(s.intervalorTimers);
        let podio = Object.values(s.jugadores).sort((a, b) => b.puntos - a.puntos);
        io.to(sala).emit('partida_terminada', podio); // Lanza la pantalla de podio final en el cliente
        return;
    }

    s.ronda++;
    s.tiempo = 60;

    let ids = Object.keys(s.jugadores);
    // Elegir un dibujante que no haya dibujado recientemente de manera inteligente
    let disponibles = ids.filter(id => !s.historialDibujantes.includes(id));
    if (disponibles.length === 0) {
        s.historialDibujantes = [];
        disponibles = ids;
    }
    s.idDibujante = disponibles[Math.floor(Math.random() * disponibles.length)];
    s.historialDibujantes.push(s.idDibujante);

    // Resetear banderas de adivinación para el nuevo turno
    Object.keys(s.jugadores).forEach(id => s.jugadores[id].adivinado = false);

    // Configurar modo de juego de manera aleatoria incluyendo el de Doble Palabra
    s.modoActual = MODOS_JUEGO[Math.floor(Math.random() * MODOS_JUEGO.length)];

    // Selección de palabras
    s.palabraActual = palabrasDificiles[Math.floor(Math.random() * palabrasDificiles.length)];
    if (s.modoActual === "Doble Palabra") {
        do {
            s.palabraActual2 = palabrasDificiles[Math.floor(Math.random() * palabrasDificiles.length)];
        } while (s.palabraActual2 === s.palabraActual);
        
        // Guiones combinados para las dos palabras
        s.guiones = generarGuiones(s.palabraActual) + "   " + generarGuiones(s.palabraActual2);
    } else {
        s.palabraActual2 = "";
        s.guiones = generarGuiones(s.palabraActual);
    }

    // Enviar estado inicial del turno
    io.to(sala).emit('actualizar_partida', {
        tiempo: s.tiempo,
        modo: s.modoActual,
        rondaVisual: s.ronda,
        idDibujante: s.idDibujante,
        guiones: s.guiones,
        palabraCompleta: s.modoActual === "Doble Palabra" ? `${s.palabraActual} + ${s.palabraActual2}` : s.palabraActual
    });

    io.to(sala).emit('dibujo_limpiar_cliente');

    // Intervalo único por sala
    clearInterval(s.intervalorTimers);
    s.intervalorTimers = setInterval(() => {
        s.tiempo--;
        io.to(sala).emit('tiempo_actualizado', s.tiempo);

        if (s.tiempo <= 0) {
            clearInterval(s.intervalorTimers);
            io.to(sala).emit('mensaje_sistema', `⏳ Tiempo agotado. La respuesta era: ${s.palabraActual.toUpperCase()} ${s.palabraActual2 ? '+ ' + s.palabraActual2.toUpperCase() : ''}`);
            setTimeout(() => avanzarSiguienteTurno(sala), 3000); // 3 segundos de pausa dramática entre turnos
        }
    }, 1000);
}

function generarGuiones(palabra) {
    return palabra.split('').map(letra => letra === ' ' ? ' ' : '_').join(' ');
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Servidor de Pinto corriendo en puerto ${PORT}`));