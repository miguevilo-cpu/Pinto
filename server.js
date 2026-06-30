const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, '')));

// 3. 🧠 PALABRAS COMPUESTAS/RELACIONADAS PARA EL MODO "DOBLE PALABRA"
const parejasPalabras = [
    { p1: "pez", p2: "martillo" },
    { p1: "agujero", p2: "negro" },
    { p1: "aurora", p2: "boreal" },
    { p1: "carta", p2: "documental" },
    { p1: "nave", p2: "espacial" },
    { p1: "caballo", p2: "marino" },
    { p1: "oso", p2: "polar" },
    { p1: "gato", p2: "volador" },
    { p1: "llave", p2: "inglesa" },
    { p1: "perro", p2: "guardian" }
];

const palabrasSimplesDificiles = [
    'fotosintesis', 'neurotransmisor', 'ultrasonido', 'apendicitis', 'esquizofrenia', 
    'entropia', 'arquitectura', 'criptografia', 'metamorfosis', 'telescopio',
    'estetoscopio', 'electrocardiograma', 'claustrofobia', 'caleidoscopio', 'paradoja'
];

const MODOS_JUEGO = ["Normal", "Un Solo Trazo", "Doble Palabra"];

let salas = {
    "Sala Alpha": { jugadores: {}, partidaActiva: false, idDibujante: null, palabraActual: "", palabraActual2: "", guiones: "", tiempo: 60, ronda: 0, intervalorTimers: null, historialDibujantes: [] },
    "Sala Beta":  { jugadores: {}, partidaActiva: false, idDibujante: null, palabraActual: "", palabraActual2: "", guiones: "", tiempo: 60, ronda: 0, intervalorTimers: null, historialDibujantes: [] },
    "Sala Omega": { jugadores: {}, partidaActiva: false, idDibujante: null, palabraActual: "", palabraActual2: "", guiones: "", tiempo: 60, ronda: 0, intervalorTimers: null, historialDibujantes: [] }
};

io.on('connection', (socket) => {
    let salaActual = null;

    socket.emit('lista_salas', Object.keys(salas));

    socket.on('entrar_sala', (data) => {
        const { nombre, emoji, sala } = data;
        if (!salas[sala]) return;

        salaActual = sala;
        socket.join(salaActual);

        salas[salaActual].jugadores[socket.id] = {
            id: socket.id,
            nombre: nombre,
            emoji: emoji,
            puntos: 0,
            adivinado: false,
            listoParaReinicio: false // Bandera para el reinicio por consenso
        };

        io.to(salaActual).emit('mensaje_sistema', `👋 ${emoji} ${nombre} se ha unido a la ${salaActual}.`);
        io.to(salaActual).emit('actualizar_puntos', Object.values(salas[salaActual].jugadores), salas[salaActual].idDibujante);
    });

    socket.on('iniciar_partida', () => {
        if (!salaActual || !salas[salaActual]) return;
        let s = salas[salaActual];
        
        // 🛑 VALIDACIÓN: Mínimo 2 jugadores para iniciar
        let cantidadJugadores = Object.keys(s.jugadores).length;
        if (cantidadJugadores < 2) {
            socket.emit('mensaje_sistema', "⚠️ No se puede iniciar la partida: Se requieren mínimo 2 jugadores.");
            return;
        }

        clearInterval(s.intervalorTimers);
        s.partidaActiva = true;
        s.ronda = 0;
        s.historialDibujantes = [];
        
        Object.keys(s.jugadores).forEach(id => {
            s.jugadores[id].puntos = 0;
            s.jugadores[id].adivinado = false;
            s.jugadores[id].listoParaReinicio = false;
        });

        io.to(salaActual).emit('actualizar_puntos', Object.values(s.jugadores), null);
        avanzarSiguienteTurno(salaActual);
    });

    // Voto para reiniciar cuando la partida ya terminó
    socket.on('votar_reinicio', () => {
        if (!salaActual || !salas[salaActual]) return;
        let s = salas[salaActual];
        if (s.jugadores[socket.id]) {
            s.jugadores[socket.id].listoParaReinicio = true;
            
            let conteoListos = Object.values(s.jugadores).filter(j => j.listoParaReinicio).length;
            let total = Object.keys(s.jugadores).length;

            io.to(salaActual).emit('mensaje_sistema', `🔄 ${s.jugadores[socket.id].nombre} quiere volver a jugar (${conteoListos}/${total}).`);

            // Si todos aceptan, se reinicia automáticamente
            if (conteoListos === total && total >= 2) {
                s.partidaActiva = true;
                s.ronda = 0;
                s.historialDibujantes = [];
                Object.keys(s.jugadores).forEach(id => {
                    s.jugadores[id].puntos = 0;
                    s.jugadores[id].adivinado = false;
                    s.jugadores[id].listoParaReinicio = false;
                });
                io.to(salaActual).emit('actualizar_puntos', Object.values(s.jugadores), null);
                avanzarSiguienteTurno(salaActual);
            }
        }
    });

    socket.on('enviar_mensaje', (texto) => {
        if (!salaActual || !salas[salaActual]) return;
        let s = salas[salaActual];
        let jugador = s.jugadores[socket.id];
        if (!jugador) return;

        if (s.partidaActiva && socket.id !== s.idDibujante && !jugador.adivinado) {
            let acerto = false;
            let msgNormalizado = texto.trim().toLowerCase().replace(/\s+/g, ' ');

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
                jugador.puntos += 100;
                if (s.jugadores[s.idDibujante]) s.jugadores[s.idDibujante].puntos += 50;

                io.to(salaActual).emit('mensaje_sistema', `🎉 ¡${jugador.emoji} ${jugador.nombre} ADIVINÓ la palabra!`);
                io.to(salaActual).emit('notificar_sonido', 'adivinado');
                io.to(salaActual).emit('actualizar_puntos', Object.values(s.jugadores), s.idDibujante);

                let todosAdivinaron = Object.values(s.jugadores).every(j => j.id === s.idDibujante || j.adivinado);
                if (todosAdivinaron) {
                    s.tiempo = 0;
                }
                return;
            }
        }

        io.to(salaActual).emit('nuevo_mensaje', { usuario: jugador.nombre, emoji: jugador.emoji, texto: texto });
    });

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
            io.to(salaActual).emit('actualizar_puntos', Object.values(s.jugadores), s.idDibujante);

            if (Object.keys(s.jugadores).length === 0) {
                clearInterval(s.intervalorTimers);
                s.partidaActiva = false;
                s.ronda = 0;
            } else if (socket.id === s.idDibujante) {
                s.tiempo = 0;
            }
        }
    });
});

function avanzarSiguienteTurno(sala) {
    let s = salas[sala];
    if (!s) return;

    if (s.ronda >= 9 || Object.keys(s.jugadores).length === 0) {
        s.partidaActiva = false;
        clearInterval(s.intervalorTimers);
        let podio = Object.values(s.jugadores).sort((a, b) => b.puntos - a.puntos);
        io.to(sala).emit('partida_terminada', podio);
        return;
    }

    s.ronda++;
    s.tiempo = 60;

    let ids = Object.keys(s.jugadores);
    let disponibles = ids.filter(id => !s.historialDibujantes.includes(id));
    if (disponibles.length === 0) {
        s.historialDibujantes = [];
        disponibles = ids;
    }
    s.idDibujante = disponibles[Math.floor(Math.random() * disponibles.length)];
    s.historialDibujantes.push(s.idDibujante);

    Object.keys(s.jugadores).forEach(id => s.jugadores[id].adivinado = false);
    s.modoActual = MODOS_JUEGO[Math.floor(Math.random() * MODOS_JUEGO.length)];

    // 4. GENERAR PALABRAS RELACIONADAS EN MODO DOBLE
    if (s.modoActual === "Doble Palabra") {
        let pareja = parejasPalabras[Math.floor(Math.random() * parejasPalabras.length)];
        s.palabraActual = pareja.p1;
        s.palabraActual2 = pareja.p2;
        // Guiones con separación visual clara mediante un indicador de "Siguiente palabra"
        s.guiones = `${generarGuiones(s.palabraActual)} &nbsp;&nbsp;[➕]&nbsp;&nbsp; ${generarGuiones(s.palabraActual2)}`;
    } else {
        s.palabraActual = palabrasSimplesDificiles[Math.floor(Math.random() * palabrasSimplesDificiles.length)];
        s.palabraActual2 = "";
        s.guiones = generarGuiones(s.palabraActual);
    }

    io.to(sala).emit('actualizar_partida', {
        tiempo: s.tiempo,
        modo: s.modoActual,
        rondaVisual: s.ronda,
        idDibujante: s.idDibujante,
        guiones: s.guiones,
        palabraCompleta: s.modoActual === "Doble Palabra" ? `${s.palabraActual} ${s.palabraActual2}` : s.palabraActual
    });

    // Refrescar lista con la corona de pintor actualizada
    io.to(sala).emit('actualizar_puntos', Object.values(s.jugadores), s.idDibujante);
    io.to(sala).emit('dibujo_limpiar_cliente');

    clearInterval(s.intervalorTimers);
    s.intervalorTimers = setInterval(() => {
        s.tiempo--;
        io.to(sala).emit('tiempo_actualizado', s.tiempo);

        if (s.tiempo <= 0) {
            clearInterval(s.intervalorTimers);
            io.to(sala).emit('mensaje_sistema', `⏳ Tiempo agotado. La respuesta era: ${s.palabraActual.toUpperCase()} ${s.palabraActual2 ? s.palabraActual2.toUpperCase() : ''}`);
            setTimeout(() => avanzarSiguienteTurno(sala), 3000);
        }
    }, 1000);
}

function generarGuiones(palabra) {
    return palabra.split('').map(() => '_').join(' ');
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));