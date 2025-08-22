const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function seedData() {
  let connection;
  
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });
    
    console.log('Connected to database successfully.');
    
    // Check if users already exist
    const [existingUsers] = await connection.execute('SELECT COUNT(*) as count FROM users');
    
    if (existingUsers[0].count > 0) {
      console.log('Users already exist in the database. Skipping seed data.');
      return;
    }
    
    console.log('Creating sample users...');
    
    // Create sample users with hashed passwords
    const users = [
      {
        username: 'demo_user',
        email: 'demo@example.com',
        password: await bcrypt.hash('password123', 10)
      },
      {
        username: 'test_user',
        email: 'test@example.com',
        password: await bcrypt.hash('test123', 10)
      },
      {
        username: 'admin',
        email: 'admin@example.com',
        password: await bcrypt.hash('admin123', 10)
      }
    ];
    
    // Insert users
    for (const user of users) {
      await connection.execute(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
        [user.username, user.email, user.password]
      );
      console.log(`Created user: ${user.username} (${user.email})`);
    }
    
    // Get the first user ID for creating sample titles
    const [userIdResult] = await connection.execute('SELECT id FROM users LIMIT 1');
    const userId = userIdResult[0].id;
    
    console.log('Creating sample titles...');
    
    // Create sample titles
    const titles = [
      {
        title: 'Sunset Over Mountains',
        instructions: 'A beautiful sunset painting with mountains in the background'
      },
      {
        title: 'Ocean Waves',
        instructions: 'Dynamic ocean waves crashing on the shore'
      },
      {
        title: 'Forest Path',
        instructions: 'A peaceful forest path with sunlight filtering through trees'
      }
    ];
    
    // Insert titles
    for (const title of titles) {
      await connection.execute(
        'INSERT INTO titles (user_id, title, instructions) VALUES (?, ?, ?)',
        [userId, title.title, title.instructions]
      );
      console.log(`Created title: ${title.title}`);
    }
    
    console.log('Sample data created successfully!');
    console.log('\n=== Sample Login Credentials ===');
    console.log('User 1: demo@example.com / password123');
    console.log('User 2: test@example.com / test123');
    console.log('User 3: admin@example.com / admin123');
    console.log('================================\n');
    
  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed.');
    }
  }
}

// Run the seed function
seedData();
