/**
 * config/mongodb.js
 * -----------------------------------------------------------------------
 * Configura la conexión a MongoDB mediante Mongoose (ODM).
 * MongoDB almacena datos no estructurados y de alto volumen:
 * Reseñas, logs de actividad y metadatos para entrenamiento de IA.
 * -----------------------------------------------------------------------
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const { MONGO_URI } = process.env;

mongoose.set('strictQuery', true);

/**
 * Establece la conexión con MongoDB y registra los listeners de eventos
 * para monitorear el estado de la conexión durante el ciclo de vida de la app.
 */
const connectMongoDB = async () => {
  if (!MONGO_URI) {
    logger.error('❌ La variable de entorno MONGO_URI no está definida.');
    process.exit(1);
  }

  // Registrar listeners antes de iniciar la conexión
  mongoose.connection.on('disconnected', () => {
    logger.warn('⚠️  MongoDB se ha desconectado.');
  });

  mongoose.connection.on('error', (err) => {
    logger.error(`❌ Error en la conexión de MongoDB: ${err.message}`);
  });

  try {
    await mongoose.connect(MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    });
    logger.info('✅ Conexión a MongoDB establecida correctamente.');
  } catch (error) {
    logger.error(`❌ Error al conectar con MongoDB: ${error.message}`);
    process.exit(1);
  }
};

// Cierre limpio al detener el servidor
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  logger.info('🔌 Conexión a MongoDB cerrada por terminación de la app.');
  process.exit(0);
});

module.exports = { connectMongoDB, mongoose };