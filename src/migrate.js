require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Ejecutando migraciones...');

    // Tabla de usuarios
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        avatar_url VARCHAR(500),
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Tabla de mini-apps
    await client.query(`
      CREATE TABLE IF NOT EXISTS mini_apps (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255),
        icon_url VARCHAR(500),
        color BIGINT DEFAULT 7103231,
        enabled BOOLEAN DEFAULT true,
        permissions TEXT[] DEFAULT '{}',
        bundle_url VARCHAR(500),
        version VARCHAR(20) DEFAULT '1.0.0',
        category VARCHAR(50) DEFAULT 'other',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Insertar usuarios iniciales
    await client.query(`
      INSERT INTO users (id, name, email, password, avatar_url, role)
      VALUES 
        ('usr_001', 'Mauricio Cantor', 'mauricio@superapp.com', 
         '$2b$10$Y.Ac/1cv0.4bWImRjmdMAuOC6hUjU4E8gg1SFI1LRSR8fBt70gW6G', 
         'https://i.pravatar.cc/150?img=8', 'admin'),
        ('usr_002', 'Ana García', 'ana@superapp.com',
         '$2b$10$Y.Ac/1cv0.4bWImRjmdMAuOC6hUjU4E8gg1SFI1LRSR8fBt70gW6G',
         'https://i.pravatar.cc/150?img=5', 'user')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Insertar mini-apps iniciales
    await client.query(`
      INSERT INTO mini_apps (id, name, description, color, permissions, version, category, bundle_url)
      VALUES
        ('com.superapp.delivery', 'Delivery', 'Pide comida', 16733986, 
         ARRAY['location'], '1.0.0', 'food', ''),
        ('com.superapp.pagos', 'Pagos', 'Sin comisión', 5025616,
         ARRAY['payments'], '1.0.0', 'finance', ''),
        ('com.superapp.tienda', 'Tienda', 'Catálogo', 2201331,
         ARRAY[]::TEXT[], '1.0.0', 'shopping', ''),
        ('com.superapp.salud', 'Salud', 'Citas médicas', 15277667,
         ARRAY[]::TEXT[], '1.0.0', 'health', ''),
        ('com.superapp.wallet', 'Wallet', 'Tu saldo', 10233776,
         ARRAY['payments'], '1.0.0', 'finance', ''),
        ('com.superapp.viajes', 'Viajes', 'Pide un carro', 38536,
         ARRAY['location'], '1.0.0', 'transport', ''),
        ('com.superapp.delivery.real', 'Delivery Real', 'Pide comida a domicilio', 16733986,
         ARRAY['location', 'payments'], '1.0.0', 'food',
         'https://pub-c13c03b06eb04ba584a460bb1e118eb5.r2.dev/miniapp-delivery/index.html')
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('✅ Migraciones completadas');
  } catch (err) {
    console.error('Error en migración:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();