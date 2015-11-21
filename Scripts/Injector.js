function createInjector(modulesToLoad, strictDi) {
    strictDi = (strictDi === true);
    var INSTANTIATING = {},
        providerSuffix = 'Provider',
        path = [],
        loadedModules = new HashMap([], true),
        providerCache = {
            $provide: {
                provider: supportObject(provider),
                factory: supportObject(factory),
                service: supportObject(service),
                value: supportObject(value),
                constant: supportObject(constant),
                decorator: decorator
            }
        },
        providerInjector = (providerCache.$injector =
            createInternalInjector(providerCache, function (serviceName, caller) {//使用闭包使得providerCache作为缓存的Hash表
                if (angular.isString(caller)) {
                    path.push(caller);
                }
                throw $injectorMinErr('unpr', "Unknown provider: {0}", path.join(' <- '));
            })),
        instanceCache = {},
        instanceInjector = (instanceCache.$injector =
            createInternalInjector(instanceCache, function (serviceName, caller) {//使用闭包使得instanceCache作为缓存的Hash表
                var provider = providerInjector.get(serviceName + providerSuffix, caller);
                return instanceInjector.invoke(provider.$get, provider, undefined, serviceName);
            }));
    forEach(loadModules(modulesToLoad), function (fn) { instanceInjector.invoke(fn || noop); });
    return instanceInjector;
    ////////////////////////////////////
    // $provider
    ////////////////////////////////////
    function reverseParams(iteratorFn) {
        return function (value, key) { iteratorFn(key, value); };
    }
    function supportObject(delegate) {
        return function (key, value) {
            if (isObject(key)) {
                //默认forEach功能处理对象是使用的是iterator.call(context,object[key],key,object),正好和provider,factory,service,value,constant,enforceReturnValue传参方式相反，故使用闭包调换传参顺序。
                forEach(key, reverseParams(delegate));//如果参数是对象，则将对象的属性以及属性值，key-value形式作为参数传递给函数，e.g. $privider({a:function K(){...}})->privider('a',function K(){...});
            } else {
                return delegate(key, value);//调用函数时，参数不是对象则直接调用
            }
        };
    }
    function provider(name, provider_) {
        assertNotHasOwnProperty(name, 'service');
        if (isFunction(provider_) || isArray(provider_)) {
            provider_ = providerInjector.instantiate(provider_);
        }
        if (!provider_.$get) {
            throw $injectorMinErr('pget', "Provider '{0}' must define $get factory method.", name);
        }
        return providerCache[name + providerSuffix] = provider_;
    }
    function enforceReturnValue(name, factory) {
        return function enforcedReturnValue() {
            var result = instanceInjector.invoke(factory, this);
            if (isUndefined(result)) {
                throw $injectorMinErr('undef', "Provider '{0}' must return a value from $get factory method.", name);
            }
            return result;
        };
    }
    function factory(name, factoryFn, enforce) {
        return provider(name, {
            $get: enforce !== false ? enforceReturnValue(name, factoryFn) : factoryFn
        });
    }
    function service(name, constructor) {
        return factory(name, ['$injector', function ($injector) {
            return $injector.instantiate(constructor);
        }]);
    }
    function value(name, val) { return factory(name, valueFn(val), false); }
    function constant(name, value) {
        assertNotHasOwnProperty(name, 'constant');
        providerCache[name] = value;
        instanceCache[name] = value;
    }
    function decorator(serviceName, decorFn) {
        var origProvider = providerInjector.get(serviceName + providerSuffix),
            orig$get = origProvider.$get;
        origProvider.$get = function () {
            var origInstance = instanceInjector.invoke(orig$get, origProvider);
            return instanceInjector.invoke(decorFn, null, { $delegate: origInstance });
        };
    }
    ////////////////////////////////////
    // Module Loading
    ////////////////////////////////////
    function loadModules(modulesToLoad) {
        var runBlocks = [], moduleFn;
        forEach(modulesToLoad, function (module) {
            if (loadedModules.get(module)) return;//如果存在则返回
            loadedModules.put(module, true);//标记已经加载过
            function runInvokeQueue(queue) {//功能函数，后边调用
                var i, ii;
                for (i = 0, ii = queue.length; i < ii; i++) {
                    var invokeArgs = queue[i], provider = providerInjector.get(invokeArgs[0]);
                    provider[invokeArgs[1]].apply(provider, invokeArgs[2]);
                }
            }
            try {
                if (isString(module)) {
                    moduleFn = angularModule(module);//新建模块，注意模块并未初始化
                    runBlocks = runBlocks.concat(loadModules(moduleFn.requires)).concat(moduleFn._runBlocks);//加载完依赖的所有需要运行的模块
                    runInvokeQueue(moduleFn._invokeQueue);//运行缓存在queue中的函数
                    runInvokeQueue(moduleFn._configBlocks);//运行缓存在queue中的函数
                } else if (isFunction(module)) {
                    runBlocks.push(providerInjector.invoke(module));
                } else if (isArray(module)) {
                    runBlocks.push(providerInjector.invoke(module));
                } else {
                    assertArgFn(module, 'module');
                }
            } catch (e) {
                if (isArray(module)) {
                    module = module[module.length - 1];
                }
                if (e.message && e.stack && e.stack.indexOf(e.message) == -1) {
                    e = e.message + '\n' + e.stack;
                }
                throw $injectorMinErr('modulerr', "Failed to instantiate module {0} due to:\n{1}", module, e.stack || e.message || e);
            }
        });
        return runBlocks;
    }
    ////////////////////////////////////
    // internal Injector
    ////////////////////////////////////
    function createInternalInjector(cache, factory) {
        function getService(serviceName, caller) {
            if (cache.hasOwnProperty(serviceName)) {
                if (cache[serviceName] === INSTANTIATING) {
                    throw $injectorMinErr('cdep', 'Circular dependency found: {0}', serviceName + ' <- ' + path.join(' <- '));
                }
                return cache[serviceName];//是自己的属性，且不为{}
            } else {
                try {
                    path.unshift(serviceName);
                    cache[serviceName] = INSTANTIATING;
                    return cache[serviceName] = factory(serviceName, caller);//肯定抛异常出来
                } catch (err) {
                    if (cache[serviceName] === INSTANTIATING) {
                        delete cache[serviceName];
                    }
                    throw err;
                } finally {
                    path.shift();
                }
            }
        }
        function invoke(fn, self, locals, serviceName) {
            if (typeof locals === 'string') {
                serviceName = locals;
                locals = null;
            }
            var args = [],
                $inject = createInjector.$$annotate(fn, strictDi, serviceName),
                length, i,
                key;
            for (i = 0, length = $inject.length; i < length; i++) {
                key = $inject[i];
                if (typeof key !== 'string') {
                    throw $injectorMinErr('itkn', 'Incorrect injection token! Expected service name as string, got {0}', key);
                }
                args.push(
                  locals && locals.hasOwnProperty(key)
                  ? locals[key]
                  : getService(key, serviceName)
                );//获得服务对象，当作参数列表
            }
            if (isArray(fn)) {//如果第一个参数是类似于['','','',...,function(){}]的数组，最后一个参数是被注入的目标函数
                fn = fn[length];
            }
            return fn.apply(self, args);
        }
        function instantiate(Type, locals, serviceName) {
            var instance = Object.create((isArray(Type) ? Type[Type.length - 1] : Type).prototype || null);//通过原型创建空对象或者拥有指定原型的对象
            var returnedValue = invoke(Type, instance, locals, serviceName);
            return isObject(returnedValue) || isFunction(returnedValue) ? returnedValue : instance;
        }
        return {
            invoke: invoke,
            instantiate: instantiate,
            get: getService,
            annotate: createInjector.$$annotate,
            has: function (name) {
                return providerCache.hasOwnProperty(name + providerSuffix) || cache.hasOwnProperty(name);
            }
        };
    }
}
//end region #injector barret wu added
createInjector.$$annotate = annotate;




function annotate(fn, strictDi, name) {
    var $inject, fnText, argDecl, last;
    if (typeof fn === 'function') {//是函数对象
        if (!($inject = fn.$inject)) {//首次时，fn.$inject为undefined，故!$inject将为true
            $inject = [];//初始化为数组
            if (fn.length) {//如果函数有形式参数
                if (strictDi) {
                    if (!isString(name) || !name) {
                        name = fn.name || anonFn(fn);
                    }
                    throw $injectorMinErr('strictdi', '{0} is not using explicit annotation and cannot be invoked in strict mode', name);
                }
                fnText = fn.toString().replace(STRIP_COMMENTS, '');//将函数转换成字符串，删除函数注释/**/
                argDecl = fnText.match(FN_ARGS);//正则表达式找到函数形式参数
                forEach(argDecl[1].split(FN_ARG_SPLIT), function (arg) {
                    arg.replace(FN_ARG, function (all, underscore, name) {
                        $inject.push(name);
                    });
                });
            }
            fn.$inject = $inject;
        }
    } else if (isArray(fn)) {//如果是个数组
        last = fn.length - 1;
        assertArgFn(fn[last], 'fn');//判断是不是
        $inject = fn.slice(0, last);//
    } else {
        assertArgFn(fn, 'fn', true);
    }
    return $inject;
}



function anonFn(fn) {
    var fnText = fn.toString().replace(STRIP_COMMENTS, ''),
        args = fnText.match(FN_ARGS);
    if (args) {
        return 'function(' + (args[1] || '').replace(/[\s\r\n]+/, ' ') + ')';
    }
    return 'fn';
}
function assertArg(arg, name, reason) {
    if (!arg) {
        throw ngMinErr('areq', "Argument '{0}' is {1}", (name || '?'), (reason || "required"));
    }
    return arg;
}
function assertArgFn(arg, name, acceptArrayAnnotation) {
    if (acceptArrayAnnotation && isArray(arg)) {
        arg = arg[arg.length - 1];
    }
    assertArg(isFunction(arg), name, 'not a function, got ' + (arg && typeof arg === 'object' ? arg.constructor.name || 'Object' : typeof arg));
    return arg;
}