require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

let cachedClient = null;

async function getCollections() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await cachedClient.connect();
    console.log('✅ MongoDB connected (cached)');
  }

  const db = cachedClient.db('nxtgm');
  return {
    accountsCollection: db.collection('accounts'),
    feedCollection: db.collection('feed'),
  };
}

// Test route
app.get('/', (req, res) => {
  res.send('✅ Server is running');
});

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const { accountsCollection } = await getCollections();

    const existingUser = await accountsCollection.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    await accountsCollection.insertOne({ username, password });
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const { accountsCollection } = await getCollections();

    const user = await accountsCollection.findOne({ username });
    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    res.json({
      message: 'Login successful',
      username: user.username,
      userId: user._id.toString(),
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Get account by username
app.post('/api/accounts', async (req, res) => {
  const { username } = req.body;
  try {
    const { accountsCollection } = await getCollections();
    const account = await accountsCollection.findOne({ username });
    res.json(account);
  } catch (error) {
    console.error('❌ Accounts error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Get all feed
app.get('/api/feed', async (req, res) => {
  try {
    const { feedCollection, accountsCollection } = await getCollections();
    const feed = await feedCollection.find({}).toArray();

    const enrichedFeed = await Promise.all(
      feed.map(async (post) => {
        let authorInfo = null;
        try {
          const author = await accountsCollection.findOne({ _id: new ObjectId(post.author) });
          authorInfo = author ? { username: author.username } : null;
        } catch {
          authorInfo = null;
        }

        return {
          ...post,
          author: authorInfo,
        };
      })
    );

    res.json(enrichedFeed);
  } catch (error) {
    console.error('❌ Feed error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Get posts by user ID
app.get('/api/post/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { feedCollection, accountsCollection } = await getCollections();

    const objectId = new ObjectId(id);
    const posts = await feedCollection.find({ author: objectId }).toArray();

    const enrichedPosts = await Promise.all(
      posts.map(async (post) => {
        let authorInfo = null;
        try {
          const author = await accountsCollection.findOne({ _id: objectId });
          authorInfo = author ? { username: author.username } : null;
        } catch {
          authorInfo = null;
        }

        return { ...post, author: authorInfo };
      })
    );

    res.json(enrichedPosts);
  } catch (error) {
    console.error('❌ Posts error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Get single post by ID
app.get('/api/feed/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { feedCollection, accountsCollection } = await getCollections();
    const post = await feedCollection.findOne({ _id: new ObjectId(id) });

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    let authorInfo = null;
    try {
      const author = await accountsCollection.findOne({ _id: new ObjectId(post.author) });
      authorInfo = author ? { username: author.username } : null;
    } catch {
      authorInfo = null;
    }

    res.json({ ...post, author: authorInfo });
  } catch (error) {
    console.error('❌ Post error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Upload post
app.post('/api/upload', async (req, res) => {
  const { author, title, desc, image_uri, location, createdAt } = req.body;
  if (!author || !title || !desc) {
    return res.status(400).json({ message: 'Title, content, and author are required' });
  }

  try {
    const { feedCollection } = await getCollections();
    const post = {
      author: new ObjectId(author),
      title,
      desc,
      image_uri,
      location,
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      likes: [],
      comments: [],
    };

    await feedCollection.insertOne(post);
    res.status(201).json({ message: 'Post uploaded successfully', title });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Delete post
app.delete('/api/delete/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { feedCollection } = await getCollections();
    const result = await feedCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Like/unlike post
app.post('/api/like/:id', async (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID required' });

  try {
    const { feedCollection } = await getCollections();
    const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

    if (!post) return res.status(404).json({ message: 'Post not found' });

    const userObjectId = new ObjectId(userId);
    const hasLiked = post.likes?.some((id) => id.toString() === userObjectId.toString());

    const update = hasLiked
      ? { $pull: { likes: userObjectId } }
      : { $addToSet: { likes: userObjectId } };

    await feedCollection.updateOne({ _id: new ObjectId(postId) }, update);

    res.json({ message: hasLiked ? 'Unliked' : 'Liked' });
  } catch (err) {
    console.error('❌ Like error:', err);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Add comment
app.post('/api/comment/:id', async (req, res) => {
  const postId = req.params.id;
  const { userId, comment } = req.body;

  if (!userId || !comment) return res.status(400).json({ message: 'User ID and comment required' });

  try {
    const { accountsCollection, feedCollection } = await getCollections();
    const user = await accountsCollection.findOne({ _id: new ObjectId(userId) });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const commentObj = {
      userId: new ObjectId(userId),
      username: user.username,
      comment,
      createdAt: new Date(),
    };

    await feedCollection.updateOne(
      { _id: new ObjectId(postId) },
      { $push: { comments: commentObj } }
    );

    res.status(201).json({ message: 'Comment added', comment: commentObj });
  } catch (err) {
    console.error('❌ Comment error:', err);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// Only start locally, Vercel handles serverless endpoints
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 Server is running on http://localhost:${port}`);
  });
}

module.exports = app; // Export for Vercel
