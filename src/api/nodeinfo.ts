import { Hono } from 'hono'
import { getInstanceConfig } from '../db/queries/admin.js'
import { countUsers } from '../db/queries/users.js'
import { config } from '../config.js'

const nodeinfoRoutes = new Hono()

// GET /.well-known/nodeinfo
nodeinfoRoutes.get('/.well-known/nodeinfo', (c) => {
  return c.json({
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `${config.baseUrl}/nodeinfo/2.0`,
      }
    ]
  })
})

// GET /nodeinfo/2.0
nodeinfoRoutes.get('/nodeinfo/2.0', async (c) => {
  const [instanceCfg, totalUsers] = await Promise.all([
    getInstanceConfig(),
    countUsers(),
  ])

  return c.json({
    version: '2.0',
    software: { name: 'mangafedi', version: '1.0.0' },
    protocols: ['activitypub'],
    usage: {
      users: { total: totalUsers, activeMonth: 0, activeHalfyear: 0 },
      localPosts: 0,
    },
    openRegistrations: config.features.registration,
    metadata: {
      nodeName: instanceCfg.name,
      nodeDescription: instanceCfg.description,
      contentTypes: instanceCfg.allowedContentTypes,
      allowsNsfw: instanceCfg.allowNsfw,
    },
  })
})

export { nodeinfoRoutes }
