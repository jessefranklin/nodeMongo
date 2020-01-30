const path = require('path');
const fs = require('fs');

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const multer = require('multer');
const graphqlHttp = require('express-graphql');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const axios = require('axios');


const graphqlSchema = require('./graphql/schema');
const graphqlResolver = require('./graphql/resolvers');
const auth = require('./middleware/auth')

const { clearImage } = require('./util/file')

// const feedRoutes = require('./routes/feed')
// const authRoutes = require('./routes/auth')

const app = express()

const fileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'images')
    },
    filename:(req,file, cb) => {
        cb(null, new Date().toISOString()+'-'+ file.originalname)
    }
});

const fileFilter = (req, file, cb) => {
    if(file.mimetype === 'image/png' || 
        file.mimetype === 'image/jpg' || 
        file.mimetype === 'image/jpeg'
        ) {
            cb(null, true)
        } else {
            cb(null, false)
        }
}

app.use(bodyParser.json());

app.use(
    multer({storage: fileStorage, fileFilter: fileFilter}).single('image')
    );
app.use('/images', express.static(path.join(__dirname,'images')));

app.use((req,res,next)=> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if(req.method === 'OPTIONS'){
        return res.sendStatus(200);
    }
    next();
})

app.use(auth);

app.put('/post-image', (req, res, next) => {
    if(!req.isAuth) {
        throw new Error('Not Auth!');
    }
    if(!req.file){
        return res.status(200).json({ message: 'no file attached'})
    }
    if(req.body.oldPath) {
        clearImage(req.body.oldPath)
    }
    return res.status(201).json({ message: 'file stored', filePath: req.file.path})
})

// app.use('/feed', feedRoutes)
// app.use('/auth', authRoutes)
const accessLogStream = fs.createWriteStream(
    path.join(__dirname, 'access.log'),
    {flags: 'a'}
)


app.use(helmet());
app.use(compression());
app.use(morgan('combined', { stream: accessLogStream }))

app.use('/graphql', graphqlHttp({
    schema: graphqlSchema,
    rootValue: graphqlResolver,
    graphiql: true,
    formatError(err) {
        if(!err.originalError) {
            return err
        }

        const data = err.originalError.data;
        const message = err.message || 'An error occurred';
        const code = err.originalError.code || 500;
        return { message: message, status: code, data: data}
    }
}))


app.use((error, req, res, next) => {
    console.log(error);
    const status = error.statusCode;
    const message = error.message;
    const data = error.data;
    res.status(status).json({ message:message, data: data })
})


const getApiAndEmit = async socket => {
    try {
        const res = await axios.get('https://api.darksky.net/forecast/cb39351be416768d79dd6ffd44df71d6/37.8267,-122.4233');
        // console.log(res.data.currently);
        socket.emit("FromAPI", res.data.currently.temperature);
    } catch (err) {
        console.log(err);
    }
}

mongoose.connect(`mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PSWD}@cluster0-hy9v3.mongodb.net/${process.env.MONGO_DEFAULT_DB}?retryWrites=true&w=majority`)
.then(result => {
    const server = app.listen(process.env.PORT || 8080);
    const io = require('./socket').init(server);
    let interval;
    io.on('connection', socket => {
        // const user = socket.req.user;
        
        console.log(`client connected ${socket.id}`);
        if(interval) clearInterval(interval);
        interval = setInterval(() => getApiAndEmit(socket), 10000)
        socket.on('disconnect', () => {
            console.log(`Socket ${socket.id} disconnected.`);
        });

    })
})
.catch(err=> console.log(err))


