const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const Product = require('./models/Product');

dotenv.config();

const sampleProducts = [
      {
        name: 'Boat Headphones',
        price: 299.99,
        category: 'Audio',
        stock: 50,
        description: 'Premium wireless over-ear noise-canceling headphones.'
      },
      {
        name: 'Noise Watch Pro',
        price: 349.99,
        category: 'Wearables',
        stock: 25,
        description: 'Elegant smartwatch with titanium band and neon UI.'
      },
      {
        name: 'Logitech Keyboard',
        price: 149.99,
        category: 'Peripherals',
        stock: 10,
        description: 'Low-profile mechanical keyboard with RGB underglow.'
      },
      {
        name: 'Sony WH-1000XM5 Headphones',
        price: 399.99,
        category: 'Audio',
        stock: 18,
        description: 'Wireless noise-canceling headphones with rich, detailed sound.'
      },
      {
        name: 'Boat Airdopes 800 Earbuds',
        price: 79.99,
        category: 'Audio',
        stock: 35,
        description: 'Compact wireless earbuds with clear calls and a pocket-sized charging case.'
      },
      {
        name: 'Samsung Galaxy Watch 7',
        price: 329.99,
        category: 'Wearables',
        stock: 14,
        description: 'Everyday smartwatch with health tracking, GPS, and a bright display.'
      },
      {
        name: 'Garmin Venu 3 Smartwatch',
        price: 449.99,
        category: 'Wearables',
        stock: 9,
        description: 'Fitness-focused smartwatch with recovery insights and long battery life.'
      },
      {
        name: 'Keychron K2 Keyboard',
        price: 109.99,
        category: 'Peripherals',
        stock: 22,
        description: 'Compact wireless mechanical keyboard with tactile switches.'
      },
      {
        name: 'Razer BlackWidow Keyboard',
        price: 179.99,
        category: 'Peripherals',
        stock: 12,
        description: 'Responsive mechanical gaming keyboard with customizable lighting.'
      }
    ];

const importData = async () => {
  try {
    await connectDB();

    let insertedCount = 0;
    for (const product of sampleProducts) {
      const result = await Product.updateOne(
        { name: product.name },
        { $setOnInsert: product },
        { upsert: true }
      );
      insertedCount += result.upsertedCount;
    }

    const totalCount = await Product.countDocuments();
    console.log(`Added ${insertedCount} catalog products. ${totalCount} products are available.`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

importData();
