const asyncHandler = (responseHandler) => {
    return async (req, res, next) => {
        Promise.resolve(
            requestHandler(req, req, next)
        ).catch(
            (err) => next(err)
        )
    }
}

export default asyncHandler

//wrapper for async express route handlers
//if an asyc controller throws an error automatically pass that error to ecpress's error 
//handlers middlerwares using next(err)
//no repeatative try catch, wrapper handles it