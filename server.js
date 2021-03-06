/*eslint-disable camelcase*/
/*eslint-disable no-console*/

require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const environment = process.env.NODE_ENV || 'development';
const configuration = require('./knexfile')[environment];
const database = require('knex')(configuration);

// Middleware used to redirect http to https
const requireHTTPS = (request, response, next) => {
  if (request.headers['x-forwarded-proto'] !== 'https') {
    return response.redirect('https://' + request.get('host') + request.url);
  }
  next();
};

// Middleware use to check for authentic token on api request
const checkAuth = (request, response, next) => {
  const { token } = request.headers;

  if (!token) {
    return response
      .status(403)
      .json('You must be authorized to hit this endpoint');
  }

  try {
    const decoded = jwt.verify(token, app.get('spiritKey'));
    response.locals.email = decoded.email;
    next();
  } catch (error) {
    return response.status(403).json('Invalid token');
  }
};

// Middleware for checking admin email
const checkAdmin = (request, response, next) => {
  if (response.locals.email.includes('@turing.io')) {
    next();
  } else {
    return response
      .status(403)
      .json({ error: 'You are not authorized at this endpoint' });
  }
};

// Middleware used to set Access-Control-Allow-Origin header in response to avoid CORS errors
const accessControlAllowOrigin = (request, response, next) => {
  response.header('Access-Control-Allow-Origin', '*');
  response.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  next();
};

app.set('port', process.env.PORT || 3000);
app.set('spiritKey', process.env.SPIRIT_KEY);

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

if (environment !== 'development' && environment !== 'test') {
  app.use(requireHTTPS);
} else if (environment !== 'test') {
  app.use(accessControlAllowOrigin);
}

app.listen(app.get('port'), () => {
  console.log(`Spirit is running on localhost:${app.get('port')}.`);
});

////// AUTHENTICATE USER //////
/// Note: Authenticate endpoint must be at top as user must be authenticated
///       prior to accessing any api endpoints

app.post('/authenticate', (request, response) => {
  for (let requiredParameter of ['email', 'appName']) {
    if (!request.body[requiredParameter]) {
      return response
        .status(422)
        .json({ error: `Missing required parameter - ${requiredParameter}` });
    }
  }

  const { email, appName } = request.body;
  const cert = app.get('spiritKey');
  const token = jwt.sign({ email, appName }, cert, { expiresIn: '6h' });

  return response.status(201).json(token);
});

if (environment !== 'test') {
  app.use(checkAuth);
}

//////  GET ALL TERMS  //////
app.get('/api/v1/terms/all', (request, response) => {
  database('terms')
    .select()
    .then(terms => {
      return response.status(200).json(terms);
    })
    .catch(error => {
      return response.status(500).json({ error });
    });
});

//////  GET ALL CATEGORIES  //////
app.get('/api/v1/categories/all', (request, response) => {
  database('categories')
    .select()
    .then(categories => {
      return response.status(200).json(categories);
    })
    .catch(error => {
      return response.status(500).json({ error });
    });
});

//////  GET TERMS BY CATEGORY ID  //////
app.get('/api/v1/categories/:category_id/terms', async (request, response) => {
  const { category_id } = request.params;

  try {
    const terms = await database('terms')
      .where('category_id', category_id)
      .select();

    if (!terms.length) {
      return response
        .status(404)
        .json({ error: `Category ${category_id} not found.` });
    } else {
      return response.status(200).json(terms);
    }
  } catch (error) {
    return response.status(500).json({ error });
  }
});

//////  GET TERMS BY TERMS ID //////
app.get('/api/v1/terms/:terms_id', async (request, response) => {
  const { terms_id } = request.params;

  try {
    const term = await database('terms')
      .where('id', terms_id)
      .select();

    if (!term.length) {
      return response
        .status(404)
        .json({ error: `Term ${terms_id} not found.` });
    } else {
      return response.status(200).json(term);
    }
  } catch (error) {
    return response.status(500).json({ error });
  }
});

//////  GET TERMS BY TERMS NAME //////
app.get('/api/v1/terms', async (request, response) => {
  const query = request.query.term;

  try {
    const term = await database('terms')
      .where('term', query)
      .select();

    if (!term.length) {
      return response.status(404).json({ error: `Term ${query} not found.` });
    } else {
      return response.status(200).json(term);
    }
  } catch (error) {
    return response.status(500).json({ error });
  }
});

if (environment !== 'test') {
  app.use(checkAdmin);
}

//////  CREATE NEW TERM (admin only) //////
// NOTE:  Requires category id in params and then term and definition in body.
//        Call will add the category name to the term.
app.post('/api/v1/categories/:category_id/terms', async (request, response) => {
  const newTerm = request.body;
  const { category_id } = request.params;

  for (let requiredParameter of ['term', 'definition']) {
    if (!newTerm[requiredParameter]) {
      return response
        .status(422)
        .json({ error: `Missing required parameter - ${requiredParameter}` });
    }
  }
  const categoryName = await database('categories')
    .where('id', category_id)
    .select();
  if (!categoryName.length) {
    return response.status(404).json({ error: `Category not found` });
  }

  const addTerm = await Object.assign({}, newTerm, {
    category_id: category_id,
    category_name: categoryName[0].name
  });

  database('terms')
    .returning('id')
    .insert(addTerm)
    .then(id => {
      return response.status(201).json(id);
    })
    .catch(error => {
      return response.status(500).json({ error });
    });
});

//////  CREATE NEW CATEGORY (admin only) //////
app.post('/api/v1/categories', (request, response) => {
  const newCategory = request.body;

  for (let requiredParameter of ['name']) {
    if (!newCategory[requiredParameter]) {
      return response
        .status(422)
        .json({ error: `Missing required parameter - ${requiredParameter}` });
    }
  }
  database('categories')
    .returning('id')
    .insert(newCategory)
    .then(id => {
      return response.status(201).json(id);
    })
    .catch(error => {
      return response.status(500).json({ error });
    });
});

//////  UPDATE TERM (admin only) //////
app.put('/api/v1/terms/:terms_id', async (request, response) => {
  const { terms_id } = request.params;
  const updatedTerm = request.body;
  const termToUpdate = await database('terms')
    .where('id', terms_id)
    .select();

  if (!termToUpdate.length) {
    return response.status(422).json({ error: `Term ${terms_id} not found.` });
  }

  await database('terms')
    .where('id', terms_id)
    .update(updatedTerm)
    .then(() => {
      return response.status(201).send({
        success: `Term ${terms_id} updated.`
      });
    })
    .catch(error => {
      return response.status(500).json({ error });
    });
});

//////  UPDATE CATEGORY (admin only) //////
app.put('/api/v1/categories/:category_id', async (request, response) => {
  const { category_id } = request.params;
  const updatedCategory = request.body;

  const categoryToUpdate = await database('categories')
    .where('id', category_id)
    .select();
  if (!categoryToUpdate.length) {
    return response
      .status(422)
      .json({ error: `Category ${category_id} not found.` });
  }

  await database('categories')
    .where('id', category_id)
    .update(updatedCategory)
    .then(() => {
      return response.status(201).send({
        success: `Category ${category_id} updated.`
      });
    })
    .catch(error => {
      return response.status(500).json({ error });
    });
});

//////  DELETE TERM (admin only) //////
app.delete('/api/v1/terms/:terms_id', async (request, response) => {
  const { terms_id } = request.params;

  try {
    const killedTerm = await database('terms')
      .returning('id')
      .where('id', terms_id)
      .delete();
    if (!killedTerm.length) {
      return response.status(422).json({ error: `Term ${terms_id} not found` });
    } else {
      return response.status(204).json({
        success: `Term ${terms_id} deleted.`
      });
    }
  } catch (error) {
    return response.status(500).json({ error });
  }
});

//////  DELETE CATEGORY (admin only) //////
app.delete('/api/v1/categories/:category_id', (request, response) => {
  const { category_id } = request.params;

  try {
    const killedCategory = database('categories')
      .returning('id')
      .where('id', category_id)
      .delete();
    if (!Object.keys(killedCategory).length) {
      return response
        .status(422)
        .json({ error: `Category ${category_id} not found.` });
    } else {
      return response.status(204).json({
        success: `Category ${category_id} deleted.`
      });
    }
  } catch (error) {
    return response.status(500).json({ error });
  }
});

module.exports = app;
