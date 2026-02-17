import { Hono } from 'hono'
import { instanceAdminRoutes } from './instance.js'
import { usersAdminRoutes } from './users.js'
import { reportsAdminRoutes } from './reports.js'
import { federationAdminRoutes } from './federation.js'

const admin = new Hono()

admin.route('/instance', instanceAdminRoutes)
admin.route('/users', usersAdminRoutes)
admin.route('', reportsAdminRoutes)      // includes /reports, /takedowns, /dmca
admin.route('/federation', federationAdminRoutes)

export { admin as adminRoutes }
