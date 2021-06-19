var createError = require('http-errors');
var express = require('express');
var path = require('path');
//var cookieParser = require('cookie-parser');
//var logger = require('morgan');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var childProcess = require('child_process');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

//app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
//app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
console.log("hello");

//app.use('/three', express.static(path.join(__dirname, 'node_modules/three/build/three.module.js')))
app.use('/build/three.module.js', express.static(path.join(__dirname, 'node_modules/three/build/three.module.js')))
app.use('/jsm/controls/OrbitControls', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/controls/OrbitControls.js')))
app.use('/jsm/loaders/GLTFLoader', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js')))
app.use('/jsm/loaders/FBXLoader', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/loaders/FBXLoader.js')))
app.use('/jsm/loaders/BVHLoader', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/loaders/BVHLoader.js')))
app.use('/jsm/libs/inflate.module.min.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/libs/inflate.module.min.js')))
app.use('/jsm/libs/fflate.module.min.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/libs/fflate.module.min.js')))
app.use('/jsm/curves/NURBSCurve.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/curves/NURBSCurve.js')))
app.use('/jsm/curves/NURBSUtils.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/curves/NURBSUtils.js')))
app.use('/jsm/loaders/MMDLoader', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/loaders/MMDLoader.js')))
app.use('/jsm/loaders/TGALoader.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/loaders/TGALoader.js')))
app.use('/jsm/libs/mmdparser.module.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/libs/mmdparser.module.js')))
app.use('/jsm/animation/MMDAnimationHelper.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/animation/MMDAnimationHelper.js')))
app.use('/jsm/animation/CCDIKSolver.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/animation/CCDIKSolver.js')))
app.use('/jsm/animation/MMDPhysics.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/animation/MMDPhysics.js')))
app.use('/jsm/postprocessing/EffectComposer.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/postprocessing/EffectComposer.js')))
app.use('/jsm/postprocessing/RenderPass.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/postprocessing/RenderPass.js')))
app.use('/jsm/postprocessing/UnrealBloomPass.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js')))
app.use('/jsm/postprocessing/ShaderPass.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/postprocessing/ShaderPass.js')))
app.use('/jsm/postprocessing/MaskPass.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/postprocessing/MaskPass.js')))
app.use('/jsm/postprocessing/Pass.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/postprocessing/Pass.js')))
app.use('/jsm/shaders/CopyShader.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm//shaders/CopyShader.js')))
app.use('/jsm/shaders/LuminosityHighPassShader.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm//shaders/LuminosityHighPassShader.js')))
app.use('/jsm/postprocessing/SSRPass.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/postprocessing/SSRPass.js')))
app.use('/jsm/objects/ReflectorForSSRPass.js', express.static(path.join(__dirname, 'node_modules/three/examples//jsm/objects/ReflectorForSSRPass.js')))
app.use('/jsm/shaders/SSRShader.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/shaders/SSRShader.js')))
app.use('/jsm/libs/stats.module.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/libs/stats.module.js')))
app.use('/jsm/libs/dat.gui.module.js', express.static(path.join(__dirname, 'node_modules/three/examples/jsm/libs/dat.gui.module.js')))

app.use('/lib/three-vrm.module.js', express.static(path.join(__dirname, 'public/scripts/lib/three-vrm/three-vrm.module.js')))

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
