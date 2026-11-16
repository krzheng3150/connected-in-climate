import app from './app.js'
import { migrate } from './db.js'

const port = process.env.PORT || 3000

await migrate()
app.listen(port, () => console.log(`listening on :${port}`))
