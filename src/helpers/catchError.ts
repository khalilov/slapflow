export const catchError = <T>(callback: () => T | PromiseLike<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    try {
      resolve(callback())
    } catch (error) {
      reject(error)
    }
  })
